// Document Verification Frontend
let currentUser = null;
let selectedDocType = null;
let documents = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initUploadZone();
  initDocTypeSelector();
});

// Auth check
async function initAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return;
    }
    currentUser = await res.json();
    document.getElementById('user-name').textContent = currentUser.name || 'User';

    // Load stats and documents
    await Promise.all([
      loadStats(),
      loadDocuments()
    ]);
  } catch (error) {
    console.error('Auth error:', error);
    window.location.href = '/login.html';
  }
}

// Load document stats
async function loadStats() {
  try {
    const res = await fetch('/api/documents/stats/summary');
    if (!res.ok) throw new Error('Failed to load stats');

    const data = await res.json();
    const stats = data.stats;

    document.getElementById('total-docs').textContent = stats.total_documents || 0;
    document.getElementById('verified-docs').textContent = stats.verified_documents || 0;
    document.getElementById('verified-credentials').textContent = stats.verified_credentials || 0;

    const scoreBoost = stats.total_score_impact || 0;
    document.getElementById('score-boost').textContent = scoreBoost > 0 ? `+${scoreBoost}` : scoreBoost;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load all documents
async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
    if (!res.ok) throw new Error('Failed to load documents');

    const data = await res.json();
    documents = data.documents || [];

    renderDocuments();
  } catch (error) {
    console.error('Error loading documents:', error);
    showEmptyState('Failed to load documents. Please refresh.');
  }
}

// Render documents list
function renderDocuments() {
  const container = document.getElementById('documents-container');

  if (documents.length === 0) {
    showEmptyState('No documents uploaded yet. Upload your first document above!');
    return;
  }

  container.innerHTML = documents.map(doc => {
    const statusClass = getStatusClass(doc.status);
    const statusText = getStatusText(doc.status);
    const icon = getDocIcon(doc.document_type);
    const score = doc.verification_score || 0;

    return `
      <div class="document-item" onclick="viewDocument(${doc.id})">
        <div class="doc-icon">${icon}</div>
        <div class="doc-info">
          <div class="doc-name">${doc.original_filename}</div>
          <div class="doc-meta">
            ${formatDocType(doc.document_type)} • Uploaded ${formatDate(doc.uploaded_at)}
          </div>
        </div>
        ${score > 0 ? `
          <div class="verification-score">
            <span class="score-value">${score}</span>
            <span class="score-label">Score</span>
          </div>
        ` : ''}
        <div class="doc-status ${statusClass}">${statusText}</div>
      </div>
    `;
  }).join('');
}

// View document details
function viewDocument(docId) {
  // In a real app, this would open a modal with verification details
  window.location.href = `/document-details.html?id=${docId}`;
}

// Show empty state
function showEmptyState(message) {
  const container = document.getElementById('documents-container');
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📄</div>
      <p>${message}</p>
    </div>
  `;
}

// Initialize upload zone
function initUploadZone() {
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  // Click to upload
  uploadZone.addEventListener('click', () => {
    if (!selectedDocType) {
      alert('Please select a document type first');
      return;
    }
    fileInput.click();
  });

  // File selected
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');

    if (!selectedDocType) {
      alert('Please select a document type first');
      return;
    }

    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
}

// Initialize document type selector
function initDocTypeSelector() {
  const buttons = document.querySelectorAll('.doc-type-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      // Remove selected from all
      buttons.forEach(b => b.classList.remove('selected'));

      // Add selected to clicked
      btn.classList.add('selected');
      selectedDocType = btn.getAttribute('data-type');
    });
  });
}

// Handle file upload
async function handleFileUpload(file) {
  if (!selectedDocType) {
    alert('Please select a document type');
    return;
  }

  // Validate file size (50MB)
  if (file.size > 50 * 1024 * 1024) {
    alert('File too large. Maximum size is 50MB.');
    return;
  }

  // Show progress
  const progressDiv = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  progressDiv.style.display = 'block';
  progressFill.style.width = '10%';

  try {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('document_type', selectedDocType);

    progressFill.style.width = '30%';

    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData
    });

    progressFill.style.width = '80%';

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Upload failed');
    }

    const result = await res.json();
    progressFill.style.width = '100%';

    // Success!
    setTimeout(() => {
      progressDiv.style.display = 'none';
      progressFill.style.width = '0%';

      // Clear selection
      selectedDocType = null;
      document.querySelectorAll('.doc-type-btn').forEach(b => b.classList.remove('selected'));

      // Reload data
      loadStats();
      loadDocuments();

      alert('Document uploaded successfully! Verification in progress...');
    }, 500);

  } catch (error) {
    console.error('Upload error:', error);
    alert('Upload failed: ' + error.message);
    progressDiv.style.display = 'none';
    progressFill.style.width = '0%';
  }
}

// Helper functions
function getStatusClass(status) {
  if (status === 'processed') return 'status-verified';
  if (status === 'flagged') return 'status-flagged';
  return 'status-pending';
}

function getStatusText(status) {
  if (status === 'processed') return '✓ Verified';
  if (status === 'flagged') return '⚠ Flagged';
  if (status === 'pending') return '⏳ Processing';
  return status;
}

function getDocIcon(type) {
  const icons = {
    resume: '📝',
    education_certificate: '🎓',
    employment_letter: '💼',
    id_document: '🪪',
    certification: '🏆',
    reference_letter: '📨'
  };
  return icons[type] || '📄';
}

function formatDocType(type) {
  return type.split('_').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
