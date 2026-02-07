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

// Auth check - uses checkAuth() from main.js which handles token properly
async function initAuth() {
  try {
    // Use checkAuth from main.js which includes proper Authorization header
    const user = await checkAuth();
    if (!user) {
      window.location.href = '/login.html';
      return;
    }
    currentUser = user;

    // Update UI
    const userName = user.name || user.email?.split('@')[0] || 'User';
    document.getElementById('user-name').textContent = userName;
    document.getElementById('user-avatar').textContent = userName.charAt(0).toUpperCase();

    // Check plan status
    if (user.is_paid) {
      document.getElementById('user-plan').textContent = 'Pro Plan';
    }

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

// Load document stats - uses apiCall from main.js for proper auth
async function loadStats() {
  try {
    const data = await apiCall('/documents/stats/summary');
    if (!data) return;

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

// Load all documents - uses apiCall from main.js for proper auth
async function loadDocuments() {
  try {
    const data = await apiCall('/documents');
    if (!data) return;

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

// View document details - show modal with verification info
async function viewDocument(docId) {
  try {
    const data = await apiCall(`/documents/${docId}`);
    if (!data || !data.document) return;

    const doc = data.document;
    const icon = getDocIcon(doc.document_type);
    const statusText = getStatusText(doc.status);
    const statusClass = getStatusClass(doc.status);

    // Remove existing modal if any
    const existingModal = document.getElementById('doc-detail-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'doc-detail-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;';
    modal.innerHTML = `
      <div style="background:var(--bg-card,#1a1a2e);border-radius:16px;padding:32px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;color:var(--text-primary,#fff);border:1px solid var(--border-color,#333);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h2 style="margin:0;font-size:20px;">${icon} Document Details</h2>
          <button onclick="document.getElementById('doc-detail-modal').remove()" style="background:none;border:none;color:var(--text-secondary,#aaa);font-size:24px;cursor:pointer;">&times;</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div><strong>Filename:</strong> ${escapeHtml(doc.original_filename)}</div>
          <div><strong>Type:</strong> ${formatDocType(doc.document_type)}</div>
          <div><strong>Status:</strong> <span class="${statusClass}">${statusText}</span></div>
          <div><strong>Uploaded:</strong> ${new Date(doc.uploaded_at || doc.created_at).toLocaleString()}</div>
          ${doc.authenticity_score != null ? `<div><strong>Authenticity Score:</strong> ${doc.authenticity_score}/100</div>` : ''}
          ${doc.fraud_risk ? `<div><strong>Fraud Risk:</strong> ${doc.fraud_risk}</div>` : ''}
          ${doc.confidence_score != null ? `<div><strong>Confidence:</strong> ${doc.confidence_score}%</div>` : ''}
          ${doc.credential_name ? `<div><strong>Credential:</strong> ${escapeHtml(doc.credential_name)}</div>` : ''}
          ${doc.issuer ? `<div><strong>Issuer:</strong> ${escapeHtml(doc.issuer)}</div>` : ''}
          ${doc.credential_status ? `<div><strong>Credential Status:</strong> ${doc.credential_status}</div>` : ''}
          ${doc.is_duplicate ? `<div style="color:#f59e0b;"><strong>⚠ Duplicate detected</strong></div>` : ''}
          ${doc.file_url ? `<div style="margin-top:8px;"><a href="${doc.file_url}" target="_blank" style="color:var(--accent-primary,#6366f1);text-decoration:none;">📎 View Original File</a></div>` : ''}
        </div>
        <div style="margin-top:20px;display:flex;gap:12px;justify-content:flex-end;">
          <button onclick="deleteDocument(${doc.id})" style="padding:8px 16px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;">Delete</button>
          <button onclick="document.getElementById('doc-detail-modal').remove()" style="padding:8px 16px;background:var(--accent-primary,#6366f1);color:white;border:none;border-radius:8px;cursor:pointer;">Close</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  } catch (error) {
    console.error('Error loading document details:', error);
    alert('Failed to load document details');
  }
}

// Delete a document
async function deleteDocument(docId) {
  if (!confirm('Are you sure you want to delete this document?')) return;
  try {
    const token = localStorage.getItem('rekrutai_token');
    const res = await fetch(`/api/documents/${docId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const modal = document.getElementById('doc-detail-modal');
      if (modal) modal.remove();
      await Promise.all([loadStats(), loadDocuments()]);
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to delete document');
    }
  } catch (error) {
    console.error('Delete error:', error);
    alert('Failed to delete document');
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

    // Include auth token for file upload (can't use apiCall since it's FormData, not JSON)
    const token = localStorage.getItem('rekrutai_token');
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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
