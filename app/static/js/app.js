// Global state
let currentSubject = 'math';
let currentRequestId = null;
let uploadedFiles = {
    question: [],
    rubrics: [],
    solution: []
};

// DOM elements
const subjectButtons = document.querySelectorAll('.subject-btn');
const generateBtn = document.getElementById('generate-btn');
const nextBtn = document.getElementById('next-btn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const rubricOutput = document.getElementById('rubric-output');

// File input elements
const questionFiles = document.getElementById('question-files');
const rubricsFiles = document.getElementById('rubrics-files');
const solutionFiles = document.getElementById('solution-files');

// Preview containers
const questionPreviews = document.getElementById('question-previews');
const rubricsPreviews = document.getElementById('rubrics-previews');
const solutionPreviews = document.getElementById('solution-previews');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    updateGenerateButton();
});

function initializeEventListeners() {
    // Subject selection
    subjectButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            selectSubject(this.dataset.subject);
        });
    });

    // File uploads
    questionFiles.addEventListener('change', (e) => handleFileUpload(e, 'question'));
    rubricsFiles.addEventListener('change', (e) => handleFileUpload(e, 'rubrics'));
    solutionFiles.addEventListener('change', (e) => handleFileUpload(e, 'solution'));

    // Drag and drop
    setupDragAndDrop('question-upload', 'question');
    setupDragAndDrop('rubrics-upload', 'rubrics');
    setupDragAndDrop('solution-upload', 'solution');

    // Action buttons
    generateBtn.addEventListener('click', generateRubrics);
    nextBtn.addEventListener('click', nextQuestion);
}

function selectSubject(subject) {
    currentSubject = subject;
    
    // Update active button
    subjectButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subject === subject);
    });
}

function setupDragAndDrop(uploadAreaId, type) {
    const uploadArea = document.getElementById(uploadAreaId);
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        const fileInput = uploadArea.querySelector('input[type="file"]');
        
        // Create a new FileList-like object
        const dt = new DataTransfer();
        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                dt.items.add(file);
            }
        });
        
        fileInput.files = dt.files;
        handleFileUpload({ target: fileInput }, type);
    });
}

function handleFileUpload(event, type) {
    const files = Array.from(event.target.files);
    const validFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (validFiles.length !== files.length) {
        showError('Only image files are allowed');
        return;
    }
    
    uploadedFiles[type] = validFiles;
    displayFilePreviews(validFiles, type);
    updateGenerateButton();
}

function displayFilePreviews(files, type) {
    const container = getPreviewContainer(type);
    container.innerHTML = '';
    
    files.forEach((file, index) => {
        const preview = createFilePreview(file, type, index);
        container.appendChild(preview);
    });
}

function getPreviewContainer(type) {
    switch(type) {
        case 'question': return questionPreviews;
        case 'rubrics': return rubricsPreviews;
        case 'solution': return solutionPreviews;
        default: return null;
    }
}

function createFilePreview(file, type, index) {
    const preview = document.createElement('div');
    preview.className = 'file-preview';
    
    const img = document.createElement('img');
    const reader = new FileReader();
    
    reader.onload = function(e) {
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.textContent = file.name;
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-file';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', () => removeFile(type, index));
    
    preview.appendChild(img);
    preview.appendChild(fileName);
    preview.appendChild(removeBtn);
    
    return preview;
}

function removeFile(type, index) {
    uploadedFiles[type].splice(index, 1);
    displayFilePreviews(uploadedFiles[type], type);
    updateFileInput(type);
    updateGenerateButton();
}

function updateFileInput(type) {
    const fileInput = getFileInput(type);
    const dt = new DataTransfer();
    
    uploadedFiles[type].forEach(file => {
        dt.items.add(file);
    });
    
    fileInput.files = dt.files;
}

function getFileInput(type) {
    switch(type) {
        case 'question': return questionFiles;
        case 'rubrics': return rubricsFiles;
        case 'solution': return solutionFiles;
        default: return null;
    }
}

function updateGenerateButton() {
    const hasAllFiles = uploadedFiles.question.length > 0 && 
                       uploadedFiles.rubrics.length > 0 && 
                       uploadedFiles.solution.length > 0;
    
    generateBtn.disabled = !hasAllFiles;
}

async function generateRubrics() {
    if (!uploadedFiles.question.length || !uploadedFiles.rubrics.length || !uploadedFiles.solution.length) {
        showError('Please upload images for all three sections (Question, Rubrics, Solution)');
        return;
    }
    
    // Show loading
    loading.style.display = 'block';
    results.style.display = 'none';
    generateBtn.disabled = true;
    
    try {
        const formData = new FormData();
        formData.append('subject', currentSubject);
        
        // Add files to form data
        uploadedFiles.question.forEach(file => {
            formData.append('question_images', file);
        });
        
        uploadedFiles.rubrics.forEach(file => {
            formData.append('rubrics_images', file);
        });
        
        uploadedFiles.solution.forEach(file => {
            formData.append('solution_images', file);
        });
        
        const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to generate rubrics');
        }
        
        const data = await response.json();
        currentRequestId = data.request_id;
        
        displayRubrics(data.rubric);
        
        // Show results and next button
        results.style.display = 'block';
        nextBtn.style.display = 'inline-block';
        
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'Failed to generate rubrics. Please try again.');
    } finally {
        loading.style.display = 'none';
        generateBtn.disabled = false;
    }
}

function displayRubrics(rubricData) {
    rubricOutput.innerHTML = '';
    
    if (!Array.isArray(rubricData)) {
        showError('Invalid rubric format received');
        return;
    }
    
    rubricData.forEach((item, index) => {
        const rubricItem = document.createElement('div');
        rubricItem.className = 'rubric-item';
        
        const criteria = document.createElement('div');
        criteria.className = 'criteria';
        criteria.textContent = item.Criteria;
        
        const score = document.createElement('div');
        score.className = 'score';
        score.textContent = `Score: ${item.score}`;
        
        rubricItem.appendChild(criteria);
        rubricItem.appendChild(score);
        rubricOutput.appendChild(rubricItem);
    });
}

async function nextQuestion() {
    if (!currentRequestId) {
        clearUI();
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('request_id', currentRequestId);
        
        const response = await fetch('/api/next', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to clear session');
        }
        
        const data = await response.json();
        showSuccess(data.message);
        
    } catch (error) {
        console.error('Error:', error);
        showError('Failed to clear session. UI will be cleared anyway.');
    } finally {
        clearUI();
    }
}

function clearUI() {
    // Reset file uploads
    uploadedFiles = {
        question: [],
        rubrics: [],
        solution: []
    };
    
    // Clear file inputs
    questionFiles.value = '';
    rubricsFiles.value = '';
    solutionFiles.value = '';
    
    // Clear previews
    questionPreviews.innerHTML = '';
    rubricsPreviews.innerHTML = '';
    solutionPreviews.innerHTML = '';
    
    // Hide results and next button
    results.style.display = 'none';
    nextBtn.style.display = 'none';
    
    // Reset request ID
    currentRequestId = null;
    
    // Update generate button
    updateGenerateButton();
    
    // Remove any error/success messages
    removeMessages();
}

function showError(message) {
    removeMessages();
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    const mainContent = document.querySelector('.main-content');
    const uploadSections = document.querySelector('.upload-sections');
    mainContent.insertBefore(errorDiv, uploadSections);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

function showSuccess(message) {
    removeMessages();
    const successDiv = document.createElement('div');
    successDiv.className = 'success';
    successDiv.textContent = message;
    
    const mainContent = document.querySelector('.main-content');
    const uploadSections = document.querySelector('.upload-sections');
    mainContent.insertBefore(successDiv, uploadSections);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.parentNode.removeChild(successDiv);
        }
    }, 3000);
}

function removeMessages() {
    const messages = document.querySelectorAll('.error, .success');
    messages.forEach(message => {
        if (message.parentNode) {
            message.parentNode.removeChild(message);
        }
    });
}