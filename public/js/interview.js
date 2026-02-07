// Interview Page JavaScript

let interviewState = {
  interviewId: null,
  questions: [],
  currentQuestionIndex: 0,
  responses: [],
  startTime: null
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  
  // Check for existing interview ID in URL
  const urlParams = new URLSearchParams(window.location.search);
  const existingId = urlParams.get('id');
  
  if (existingId) {
    loadExistingInterview(existingId);
  } else {
    setupForm();
  }
});

// Setup form handlers
function setupForm() {
  const form = document.getElementById('setup-form');
  form.addEventListener('submit', handleStartInterview);
}

// Start a new interview
async function handleStartInterview(e) {
  e.preventDefault();
  
  const jobTitle = document.getElementById('job-title').value;
  const jobDescription = document.getElementById('job-description').value;
  const questionCount = document.getElementById('question-count').value;
  
  showLoading('Generating interview questions...');
  
  try {
    const data = await apiCall('/interviews/start', {
      method: 'POST',
      body: JSON.stringify({
        job_title: jobTitle,
        job_description: jobDescription,
        question_count: parseInt(questionCount)
      })
    });
    
    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to start interview');
    }
    
    interviewState.interviewId = data.interview.id;
    interviewState.questions = data.questions;
    interviewState.currentQuestionIndex = 0;
    interviewState.responses = [];
    interviewState.startTime = Date.now();
    
    hideLoading();
    showInterviewScreen();
    displayQuestion(0);
    
  } catch (err) {
    hideLoading();
    alert('Failed to start interview: ' + err.message);
  }
}

// Load existing interview
async function loadExistingInterview(id) {
  showLoading('Loading interview...');
  
  try {
    const data = await apiCall(`/interviews/${id}`);
    
    if (!data || !data.interview) {
      throw new Error('Interview not found');
    }
    
    const interview = data.interview;
    
    if (interview.status === 'completed') {
      displayResults(interview);
    } else {
      interviewState.interviewId = interview.id;
      interviewState.questions = interview.questions;
      interviewState.responses = interview.responses || [];
      interviewState.currentQuestionIndex = interviewState.responses.filter(r => r).length;
      
      hideLoading();
      showInterviewScreen();
      displayQuestion(interviewState.currentQuestionIndex);
    }
    
  } catch (err) {
    hideLoading();
    alert('Failed to load interview: ' + err.message);
    window.location.href = '/dashboard.html';
  }
}

// Show interview screen
function showInterviewScreen() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('interview-screen').style.display = 'flex';
  document.getElementById('progress-container').style.display = 'flex';
  
  // Setup camera (optional)
  setupCamera();
  
  // Setup response handlers
  document.getElementById('submit-response-btn').addEventListener('click', submitResponse);
  document.getElementById('skip-btn').addEventListener('click', skipQuestion);
}

// Display current question
function displayQuestion(index) {
  if (index >= interviewState.questions.length) {
    completeInterview();
    return;
  }
  
  const question = interviewState.questions[index];
  
  document.getElementById('question-label').textContent = 
    question.category ? `${question.category} Question` : 'Interview Question';
  document.getElementById('question-text').textContent = question.question;
  
  // Update progress
  const progress = ((index + 1) / interviewState.questions.length) * 100;
  document.getElementById('progress-fill').style.width = `${progress}%`;
  document.getElementById('progress-text').textContent = 
    `Question ${index + 1} of ${interviewState.questions.length}`;
  
  // Clear response
  document.getElementById('response-text').value = '';
}

// Setup camera and microphone
async function setupCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const video = document.getElementById('video-preview');
    video.srcObject = stream;
    document.getElementById('video-overlay').style.display = 'none';

    // Verify audio tracks are present
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      const track = audioTracks[0];
      if (!track.enabled) track.enabled = true;
      console.log('Microphone active:', track.label);
    } else {
      console.warn('No microphone detected in stream');
    }
  } catch (err) {
    console.warn('Camera/microphone not available:', err);
  }
}

// Submit response
async function submitResponse() {
  const responseText = document.getElementById('response-text').value.trim();
  
  if (!responseText) {
    alert('Please provide a response before submitting.');
    return;
  }
  
  showLoading('Analyzing your response...');
  
  try {
    const data = await apiCall(`/interviews/${interviewState.interviewId}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        question_index: interviewState.currentQuestionIndex,
        response_text: responseText
      })
    });
    
    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to submit response');
    }
    
    interviewState.responses[interviewState.currentQuestionIndex] = {
      text: responseText,
      analysis: data.analysis
    };
    
    hideLoading();
    showFeedback(data.analysis);
    
  } catch (err) {
    hideLoading();
    alert('Failed to analyze response: ' + err.message);
  }
}

// Show feedback for response
function showFeedback(analysis) {
  document.getElementById('interview-screen').style.display = 'none';
  document.getElementById('feedback-screen').style.display = 'flex';
  
  document.getElementById('question-score').textContent = `${analysis.score}/10`;
  
  const strengthsList = document.getElementById('feedback-strengths');
  strengthsList.innerHTML = (analysis.strengths || []).map(s => `<li>${s}</li>`).join('');
  
  const improvementsList = document.getElementById('feedback-improvements');
  improvementsList.innerHTML = (analysis.improvements || []).map(i => `<li>${i}</li>`).join('');
  
  document.getElementById('feedback-detailed').textContent = analysis.detailed_feedback || '';
  
  // Setup next button
  document.getElementById('next-question-btn').onclick = () => {
    interviewState.currentQuestionIndex++;
    document.getElementById('feedback-screen').style.display = 'none';
    document.getElementById('interview-screen').style.display = 'flex';
    displayQuestion(interviewState.currentQuestionIndex);
  };
  
  // Update button text for last question
  if (interviewState.currentQuestionIndex >= interviewState.questions.length - 1) {
    document.getElementById('next-question-btn').innerHTML = 'See Results <span>→</span>';
  }
}

// Skip question
function skipQuestion() {
  interviewState.currentQuestionIndex++;
  displayQuestion(interviewState.currentQuestionIndex);
}

// Complete interview
async function completeInterview() {
  showLoading('Generating your final results...');
  
  try {
    const data = await apiCall(`/interviews/${interviewState.interviewId}/complete`, {
      method: 'POST'
    });
    
    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to complete interview');
    }
    
    hideLoading();
    displayResults(data);
    
  } catch (err) {
    hideLoading();
    alert('Failed to generate results: ' + err.message);
    window.location.href = '/dashboard.html';
  }
}

// Display final results
function displayResults(data) {
  const feedback = data.overall_feedback || data.ai_feedback || {};
  
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('interview-screen').style.display = 'none';
  document.getElementById('feedback-screen').style.display = 'none';
  document.getElementById('progress-container').style.display = 'none';
  document.getElementById('results-screen').style.display = 'flex';
  
  document.getElementById('overall-score').textContent = feedback.overall_score || '-';
  document.getElementById('overall-summary').textContent = feedback.summary || 'Interview completed.';
  
  // Set readiness badge
  const badge = document.getElementById('readiness-badge');
  const readiness = feedback.interview_readiness || 'almost_ready';
  badge.textContent = readiness === 'ready' ? 'Interview Ready!' : 
                       readiness === 'almost_ready' ? 'Almost Ready' : 'Needs Practice';
  badge.className = 'readiness-badge ' + 
    (readiness === 'ready' ? 'ready' : readiness === 'almost_ready' ? 'almost' : 'needs-work');
  
  // Strengths
  const strengthsList = document.getElementById('results-strengths');
  strengthsList.innerHTML = (feedback.top_strengths || []).map(s => `<li>${s}</li>`).join('') || '<li>Complete more questions for detailed feedback</li>';
  
  // Improvements
  const improvementsList = document.getElementById('results-improvements');
  improvementsList.innerHTML = (feedback.priority_improvements || []).map(i => `<li>${i}</li>`).join('') || '<li>Complete more questions for detailed feedback</li>';
  
  // Recommendations
  const recommendationsList = document.getElementById('results-recommendations');
  recommendationsList.innerHTML = (feedback.recommended_practice || []).map(r => `<li>${r}</li>`).join('') || '<li>Keep practicing to improve your interview skills</li>';
}

// Loading helpers
function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}