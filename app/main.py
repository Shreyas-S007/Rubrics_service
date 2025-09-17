from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request
import os
import json
import uuid
import shutil
from typing import List
from dotenv import load_dotenv
import google.generativeai as genai
import PIL.Image
from pathlib import Path
import typing_extensions as typing
import ast

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="Rubrics Service", description="Generate rubrics from image inputs", version="1.1")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

# Create necessary directories
os.makedirs("app/storage/temp", exist_ok=True)
os.makedirs("app/storage/processed", exist_ok=True)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables")

genai.configure(api_key=GEMINI_API_KEY)

# Response schema for rubrics
class RubricResponse(typing.TypedDict):
    Criteria: str
    score: float

# Gemini model setup
gemini_flash_exp = genai.GenerativeModel(
    MODEL_NAME,
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        response_schema=list[RubricResponse]
    )
)

# Load prompts from Python file (dict literal)
def load_prompts():
    """Load subject-specific prompts from app/prompts/prompts.py"""
    try:
        with open("app/prompts/prompts.py", "r", encoding="utf-8") as f:
            content = f.read()
        # prompts.py contains a top-level dict literal
        return ast.literal_eval(content)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="prompts.py not found at app/prompts/prompts.py")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load prompts: {e}")

def get_rubric(images: List[str], subject: str = "math") -> List[dict]:
    """
    Generate a detailed grading rubric based on the provided question, solution, and initial rubrics.
    Args:
        images (List[str]): A list of image paths containing the question, solution, and initial rubrics.
        subject (str): The subject for which to generate rubrics (math, physics, chemistry).

    Returns:
        List[dict]: A list representing the improved rubric with detailed assessment criteria.
    """
    
    # Load prompts and get the appropriate template
    prompts = load_prompts()
    
    # Get the subject-specific template
    if subject.lower() not in prompts:
        raise HTTPException(status_code=400, detail=f"No prompt template found for subject: {subject}")
    
    template = prompts[subject.lower()]["generate_rubric"]

    img = []
    for image_path in images:
        img.append(PIL.Image.open(image_path))

    # Build the content list for Gemini
    content = [template, "question", img[0], "rubrics marking scheme", img[1]]

    # Add solution pages (from img[2] onwards)
    for i in range(2, len(img)):
        if i == 2:
            content.extend(["solution", img[i]])
        else:
            content.extend([f"solution page {i-1}", img[i]])

    # Generate the rubric using Gemini
    try:
        gemini_response = gemini_flash_exp.generate_content(content)
        result = json.loads(gemini_response.text)
        return result
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing rubric: {str(e)}")
    except Exception as e:
        print(f"Error generating rubric: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating rubric: {str(e)}")

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serve the main UI page"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/generate")
async def generate_rubric(
    subject: str = Form(...),
    question_images: List[UploadFile] = File(...),
    rubrics_images: List[UploadFile] = File(...),
    solution_images: List[UploadFile] = File(...)
):
    """
    Generate rubric from uploaded images
    """
    # Validate subject
    valid_subjects = ["math", "physics", "chemistry"]
    if subject.lower() not in valid_subjects:
        raise HTTPException(status_code=400, detail=f"Invalid subject. Must be one of: {valid_subjects}")
    
    # Generate unique request ID
    request_id = str(uuid.uuid4())
    request_dir = f"app/storage/temp/{request_id}"
    os.makedirs(request_dir, exist_ok=True)
    
    try:
        # Validate and save files
        all_files = [question_images, rubrics_images, solution_images]
        file_types = ["question", "rubrics", "solution"]
        saved_paths = []
        
        for file_list, file_type in zip(all_files, file_types):
            if not file_list:
                raise HTTPException(status_code=400, detail=f"No {file_type} images provided")
            
            type_paths = []
            for i, file in enumerate(file_list):
                # Validate file type
                if not file.content_type or not file.content_type.startswith('image/'):
                    raise HTTPException(status_code=400, detail=f"Invalid file type for {file_type} image {i+1}. Must be an image.")
                
                # Save file
                file_path = f"{request_dir}/{file_type}_{i+1}_{file.filename}"
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)
                type_paths.append(file_path)
            
            saved_paths.extend(type_paths)
        
        # Generate rubric using the notebook logic
        rubric_result = get_rubric(saved_paths, subject.lower())
        
        return {
            "request_id": request_id,
            "rubric": rubric_result,
            "subject": subject
        }
        
    except Exception as e:
        # Clean up on error
        if os.path.exists(request_dir):
            shutil.rmtree(request_dir)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

@app.post("/api/next")
async def next_question(request_id: str = Form(...)):
    """
    Clear previous session and temp files
    """
    try:
        request_dir = f"app/storage/temp/{request_id}"
        if os.path.exists(request_dir):
            shutil.rmtree(request_dir)
        
        return {"message": "Session cleared successfully", "request_id": request_id}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error clearing session: {str(e)}")

@app.get("/storage/temp/{request_id}/{filename}")
async def serve_temp_file(request_id: str, filename: str):
    """
    Serve temporary uploaded files for preview
    """
    file_path = f"app/storage/temp/{request_id}/{filename}"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)