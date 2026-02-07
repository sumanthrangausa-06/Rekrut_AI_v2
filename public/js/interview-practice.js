// Interview Practice Page JavaScript

let practiceState = {
  currentQuestion: null,
  stats: null,
  user: null
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }

  practiceState.user = user;

  // Setup tabs
  setupTabs();

  // Load initial data
  await loadStats();
  await loadQuestionLibrary();
});

// Setup tab switching
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;

      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`${tabName}-content`).classList.add('active');

      // Load content if needed
      if (tabName === 'progress') {
        loadProgressDashboard();
      }
    });
  });
}

// Load practice stats
async function loadStats() {
  try {
    const data = await apiCall('/interviews/practice/stats');

    if (data && data.stats) {
      practiceState.stats = data.stats;

      document.getElementById('stat-total').textContent = data.stats.total_questions || 0;
      document.getElementById('stat-avg').textContent =
        data.stats.average_score ? `${data.stats.average_score.toFixed(1)}/10` : '—';

      // Calculate improvement
      if (data.stats.improvement) {
        const improvement = data.stats.improvement;
        const sign = improvement > 0 ? '+' : '';
        document.getElementById('stat-improvement').textContent = `${sign}${improvement.toFixed(1)}%`;
      } else {
        document.getElementById('stat-improvement').textContent = '—';
      }

      document.getElementById('stat-streak').textContent = data.stats.day_streak || 0;
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Load question library
async function loadQuestionLibrary() {
  showLoading('Loading question library...');

  try {
    const data = await apiCall('/interviews/practice/library');

    if (data && data.questions) {
      renderQuestionLibrary(data.questions);
    }

    hideLoading();
  } catch (err) {
    console.error('Failed to load question library:', err);
    hideLoading();

    document.getElementById('question-library').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📚</div>
        <h3>Question Library</h3>
        <p>Unable to load questions. Please try again later.</p>
      </div>
    `;
  }
}

// Render question library
function renderQuestionLibrary(questions) {
  const container = document.getElementById('question-library');

  if (questions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📚</div>
        <h3>No Questions Available</h3>
        <p>Check back soon for practice questions!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = questions.map((q, idx) => `
    <div class="question-card" data-question-idx="${idx}">
      <span class="question-category-badge category-${q.category}">
        ${q.category.charAt(0).toUpperCase() + q.category.slice(1)}
      </span>
      <div class="question-text">${q.question}</div>
      <div class="question-meta">
        <span>💪 ${q.difficulty}</span>
        ${q.times_practiced ? `<span>📝 Practiced ${q.times_practiced} times</span>` : ''}
        ${q.last_score ? `<span>⭐ Last score: ${q.last_score}/10</span>` : ''}
      </div>
    </div>
  `).join('');

  // Attach click handlers safely (no inline JSON in onclick)
  container.querySelectorAll('.question-card[data-question-idx]').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.questionIdx);
      openPracticeModal(questions[idx]);
    });
  });
}

// Open practice modal with question
function openPracticeModal(question) {
  practiceState.currentQuestion = question;

  document.getElementById('modal-question-text').textContent = question.question;
  document.getElementById('modal-category-badge').textContent =
    `${question.category.charAt(0).toUpperCase() + question.category.slice(1)} • ${question.difficulty}`;

  document.getElementById('practice-response').value = '';
  document.getElementById('practice-question-view').style.display = 'block';
  document.getElementById('coaching-result').style.display = 'none';
  document.getElementById('coaching-result').classList.remove('active');

  document.getElementById('practice-modal').classList.add('active');
}

// Close practice modal
function closePracticeModal() {
  document.getElementById('practice-modal').classList.remove('active');
  practiceState.currentQuestion = null;
}

// Submit practice response for coaching
async function submitPracticeResponse() {
  const response = document.getElementById('practice-response').value.trim();

  if (!response) {
    alert('Please provide a response before getting coaching.');
    return;
  }

  if (response.length < 50) {
    alert('Please provide a more detailed response (at least 50 characters).');
    return;
  }

  showLoading('AI is analyzing your response...');

  try {
    const data = await apiCall('/interviews/practice/submit', {
      method: 'POST',
      body: JSON.stringify({
        question_id: practiceState.currentQuestion.id,
        question: practiceState.currentQuestion.question,
        category: practiceState.currentQuestion.category,
        response_text: response
      })
    });

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to get coaching');
    }

    hideLoading();
    displayCoachingResult(data.coaching);

    // Reload stats
    await loadStats();

  } catch (err) {
    hideLoading();
    alert('Failed to analyze response: ' + err.message);
  }
}

// Display coaching result
function displayCoachingResult(coaching) {
  const resultContainer = document.getElementById('coaching-result');

  resultContainer.innerHTML = `
    <div class="score-display">
      <div class="score-value">${coaching.score}/10</div>
      <div class="score-label">Your Score</div>
    </div>

    ${coaching.strengths && coaching.strengths.length > 0 ? `
      <div class="coaching-section">
        <h4>✅ Strengths</h4>
        <ul class="coaching-list">
          ${coaching.strengths.map(s => `<li>✓ ${s}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${coaching.improvements && coaching.improvements.length > 0 ? `
      <div class="coaching-section">
        <h4>💡 Areas for Improvement</h4>
        <ul class="coaching-list">
          ${coaching.improvements.map(i => `<li>→ ${i}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${coaching.specific_tips && coaching.specific_tips.length > 0 ? `
      <div class="coaching-section">
        <h4>🎯 Specific Tips</h4>
        <ul class="coaching-list">
          ${coaching.specific_tips.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${coaching.improved_response ? `
      <div class="coaching-section">
        <h4>📝 Example Strong Response</h4>
        <p style="margin-bottom: 0.5rem; color: var(--text-muted); font-size: 0.875rem;">
          Here's how you could strengthen your response:
        </p>
        <div class="improved-response">
          ${coaching.improved_response}
        </div>
      </div>
    ` : ''}

    ${coaching.common_mistake ? `
      <div class="coaching-section">
        <h4>⚠️ Common Mistake to Avoid</h4>
        <p style="color: var(--text-secondary);">${coaching.common_mistake}</p>
      </div>
    ` : ''}

    ${coaching.body_language_tips && coaching.body_language_tips.length > 0 ? `
      <div class="coaching-section">
        <h4>🗣️ Delivery Tips</h4>
        <ul class="coaching-list">
          ${coaching.body_language_tips.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    ${coaching.practice_prompt ? `
      <div class="coaching-section">
        <h4>🎓 Next Practice Question</h4>
        <p style="color: var(--text-secondary);">${coaching.practice_prompt}</p>
      </div>
    ` : ''}

    <div style="display: flex; gap: 1rem; margin-top: 2rem;">
      <button class="btn btn-ghost btn-large" onclick="closePracticeModal()" style="flex: 1;">
        Close
      </button>
      <button class="btn btn-primary btn-large" onclick="practiceAnother()" style="flex: 1;">
        Practice Another
      </button>
    </div>
  `;

  document.getElementById('practice-question-view').style.display = 'none';
  resultContainer.style.display = 'block';
  resultContainer.classList.add('active');
}

// Practice another question
function practiceAnother() {
  closePracticeModal();

  // Reload question library to get updated stats
  setTimeout(() => {
    loadQuestionLibrary();
  }, 300);
}

// Load progress dashboard
async function loadProgressDashboard() {
  try {
    const data = await apiCall('/interviews/practice/progress');

    if (data && data.progress) {
      renderCategoryProgress(data.progress.by_category || []);
      renderRecentSessions(data.progress.recent_sessions || []);
    }
  } catch (err) {
    console.error('Failed to load progress:', err);

    document.getElementById('category-progress').innerHTML = `
      <div class="empty-state">
        <p>No practice data yet. Start practicing to see your progress!</p>
      </div>
    `;
  }
}

// Render category progress
function renderCategoryProgress(categoryData) {
  const container = document.getElementById('category-progress');

  if (categoryData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No practice data yet. Start practicing to see your progress!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = categoryData.map(cat => `
    <div class="progress-item">
      <div class="progress-label">
        <span>${cat.category.charAt(0).toUpperCase() + cat.category.slice(1)}</span>
        <span>${cat.average_score ? cat.average_score.toFixed(1) : '0'}/10 (${cat.count} practiced)</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${(cat.average_score || 0) * 10}%;"></div>
      </div>
    </div>
  `).join('');
}

// Render recent sessions
function renderRecentSessions(sessions) {
  const container = document.getElementById('recent-sessions');

  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No practice sessions yet. Start practicing!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: grid; gap: 1rem;">
      ${sessions.map(session => `
        <div style="background: #f9fafb; padding: 1.5rem; border-radius: 12px; border-left: 4px solid #667eea;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">
                ${session.question.substring(0, 80)}${session.question.length > 80 ? '...' : ''}
              </div>
              <div style="font-size: 0.875rem; color: var(--text-muted);">
                ${session.category} • ${formatDate(session.created_at)}
              </div>
            </div>
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 0.5rem 1rem; border-radius: 8px; font-weight: 700; min-width: 60px; text-align: center;">
              ${session.score}/10
            </div>
          </div>
          ${session.improvements && session.improvements.length > 0 ? `
            <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.5rem;">
              <strong>Key improvement:</strong> ${session.improvements[0]}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// Format date helper
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Loading helpers
function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}
