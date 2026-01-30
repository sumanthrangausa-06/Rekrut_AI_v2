const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const polsiaAI = require('../lib/polsia-ai');

// ============================================
// OFFER GENERATION
// ============================================

// Create offer from template
router.post('/offers', authMiddleware, async (req, res) => {
  try {
    const { candidate_id, job_id, title, salary, start_date, benefits, template_data } = req.body;

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1 AND company_id = $2', [job_id, req.user.company_id]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const result = await pool.query(
      `INSERT INTO offers (
        candidate_id, job_id, recruiter_id, company_id, title, company_name,
        salary, start_date, benefits, template_data, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [candidate_id, job_id, req.user.id, req.user.company_id, title, job.rows[0].company || 'Rekrut AI',
       salary, start_date, benefits, JSON.stringify(template_data || {}), 'draft']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// Get all offers for recruiter's company
router.get('/offers', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*,
        u.name as candidate_name,
        u.email as candidate_email,
        j.title as job_title,
        r.name as recruiter_name
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      LEFT JOIN jobs j ON o.job_id = j.id
      LEFT JOIN users r ON o.recruiter_id = r.id
      WHERE o.company_id = $1
      ORDER BY o.created_at DESC`,
      [req.user.company_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching offers:', err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

// Get candidate's offers
router.get('/offers/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*,
        j.title as job_title,
        j.company
      FROM offers o
      LEFT JOIN jobs j ON o.job_id = j.id
      WHERE o.candidate_id = $1
      ORDER BY o.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching offers:', err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

// Send offer to candidate
router.post('/offers/:id/send', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE offers
       SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [req.params.id, req.user.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error sending offer:', err);
    res.status(500).json({ error: 'Failed to send offer' });
  }
});

// Candidate views offer (track engagement)
router.post('/offers/:id/view', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE offers
       SET viewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2
       RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error marking offer as viewed:', err);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

// Accept offer
router.post('/offers/:id/accept', authMiddleware, async (req, res) => {
  try {
    const { signature_url } = req.body;

    const result = await pool.query(
      `UPDATE offers
       SET status = 'accepted', accepted_at = NOW(), signature_url = $3, updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2
       RETURNING *`,
      [req.params.id, req.user.id, signature_url]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Create default onboarding checklist
    const offer = result.rows[0];
    const defaultItems = [
      { id: 1, task: 'Complete I-9 form', required: true },
      { id: 2, task: 'Upload government-issued ID', required: true },
      { id: 3, task: 'Set up direct deposit', required: true },
      { id: 4, task: 'Complete tax withholding (W-4)', required: true },
      { id: 5, task: 'Sign employee handbook acknowledgment', required: true },
      { id: 6, task: 'Submit emergency contact information', required: true },
      { id: 7, task: 'Complete IT setup (email, laptop)', required: false },
      { id: 8, task: 'Schedule first day orientation', required: true }
    ];

    await pool.query(
      `INSERT INTO onboarding_checklists
       (offer_id, candidate_id, title, description, items, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        offer.id,
        offer.candidate_id,
        'Pre-Onboarding Checklist',
        'Complete these tasks before your first day',
        JSON.stringify(defaultItems),
        offer.start_date
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error accepting offer:', err);
    res.status(500).json({ error: 'Failed to accept offer' });
  }
});

// Decline offer
router.post('/offers/:id/decline', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    const result = await pool.query(
      `UPDATE offers
       SET status = 'declined', declined_at = NOW(), decline_reason = $3, updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2
       RETURNING *`,
      [req.params.id, req.user.id, reason]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error declining offer:', err);
    res.status(500).json({ error: 'Failed to decline offer' });
  }
});

// ============================================
// ONBOARDING CHECKLISTS
// ============================================

// Get candidate's checklists
router.get('/checklists', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM onboarding_checklists
       WHERE candidate_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching checklists:', err);
    res.status(500).json({ error: 'Failed to fetch checklists' });
  }
});

// Update checklist item completion
router.post('/checklists/:id/complete', authMiddleware, async (req, res) => {
  try {
    const { item_id } = req.body;

    const checklist = await pool.query(
      'SELECT * FROM onboarding_checklists WHERE id = $1 AND candidate_id = $2',
      [req.params.id, req.user.id]
    );

    if (checklist.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    const completedItems = checklist.rows[0].completed_items || [];
    if (!completedItems.includes(item_id)) {
      completedItems.push(item_id);
    }

    const items = checklist.rows[0].items || [];
    const allCompleted = items.every(item => completedItems.includes(item.id));

    const result = await pool.query(
      `UPDATE onboarding_checklists
       SET completed_items = $1,
           status = $2,
           completed_at = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        JSON.stringify(completedItems),
        allCompleted ? 'completed' : 'in_progress',
        allCompleted ? new Date() : null,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating checklist:', err);
    res.status(500).json({ error: 'Failed to update checklist' });
  }
});

// ============================================
// DOCUMENT COLLECTION
// ============================================

// Upload onboarding document
router.post('/documents', authMiddleware, async (req, res) => {
  try {
    const { checklist_id, document_type, document_url } = req.body;

    const result = await pool.query(
      `INSERT INTO onboarding_documents
       (checklist_id, candidate_id, document_type, document_url, status, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [checklist_id, req.user.id, document_type, document_url, 'pending']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error uploading document:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Get documents for checklist
router.get('/checklists/:id/documents', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM onboarding_documents
       WHERE checklist_id = $1 AND candidate_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// ============================================
// POST-HIRE FEEDBACK
// ============================================

// Create feedback survey (auto-scheduled by system)
router.post('/feedback/schedule', authMiddleware, async (req, res) => {
  try {
    const { employee_id, day_mark } = req.body;

    const questions = {
      30: [
        'How would you rate your onboarding experience?',
        'Do you feel prepared to do your job?',
        'Is there anything we could improve?'
      ],
      60: [
        'How satisfied are you with your role?',
        'Do you have the resources you need to succeed?',
        'How would you rate communication with your manager?'
      ],
      90: [
        'Would you recommend this company to a friend?',
        'What has been your biggest challenge so far?',
        'What has exceeded your expectations?'
      ]
    };

    const result = await pool.query(
      `INSERT INTO post_hire_feedback
       (employee_id, manager_id, feedback_type, day_mark, questions, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [
        employee_id,
        req.user.id,
        'check_in',
        day_mark,
        JSON.stringify(questions[day_mark] || questions[30]),
        'sent'
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error scheduling feedback:', err);
    res.status(500).json({ error: 'Failed to schedule feedback' });
  }
});

// Get employee's pending feedback
router.get('/feedback/pending', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM post_hire_feedback
       WHERE employee_id = $1 AND status = 'sent'
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Submit feedback responses
router.post('/feedback/:id/submit', authMiddleware, async (req, res) => {
  try {
    const { responses, satisfaction_score, would_recommend, comments } = req.body;

    // Analyze feedback with AI
    const aiAnalysis = await analyzeFeedbackWithAI(responses, comments);

    const result = await pool.query(
      `UPDATE post_hire_feedback
       SET responses = $1,
           satisfaction_score = $2,
           would_recommend = $3,
           comments = $4,
           ai_analysis = $5,
           status = 'completed',
           completed_at = NOW()
       WHERE id = $6 AND employee_id = $7
       RETURNING *`,
      [
        JSON.stringify(responses),
        satisfaction_score,
        would_recommend,
        comments,
        JSON.stringify(aiAnalysis),
        req.params.id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error submitting feedback:', err);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get feedback analytics for manager
router.get('/feedback/analytics', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        day_mark,
        AVG(satisfaction_score) as avg_satisfaction,
        COUNT(*) as total_responses,
        SUM(CASE WHEN would_recommend THEN 1 ELSE 0 END) as would_recommend_count
      FROM post_hire_feedback
      WHERE manager_id = $1 AND status = 'completed'
      GROUP BY day_mark
      ORDER BY day_mark`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ============================================
// ONBOARDING AI ASSISTANT
// ============================================

// Start or continue chat session
router.post('/assistant/chat', authMiddleware, async (req, res) => {
  try {
    const { message, checklist_id } = req.body;

    // Get or create chat session
    let session = await pool.query(
      `SELECT * FROM onboarding_chats
       WHERE candidate_id = $1 AND checklist_id = $2 AND is_active = true
       ORDER BY session_started DESC LIMIT 1`,
      [req.user.id, checklist_id || null]
    );

    let sessionId;
    let messages = [];

    if (session.rows.length === 0) {
      const newSession = await pool.query(
        `INSERT INTO onboarding_chats (candidate_id, checklist_id, messages)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.user.id, checklist_id || null, JSON.stringify([])]
      );
      sessionId = newSession.rows[0].id;
    } else {
      sessionId = session.rows[0].id;
      messages = session.rows[0].messages || [];
    }

    // Get company policies for context
    const policies = await pool.query(
      `SELECT category, title, content
       FROM company_policies
       WHERE is_active = true
       ORDER BY category`
    );

    // Build context from policies
    const policyContext = policies.rows.map(p =>
      `${p.category}: ${p.title}\n${p.content}`
    ).join('\n\n');

    // Add user message
    messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    // Get AI response
    const aiResponse = await getOnboardingAssistantResponse(
      messages,
      policyContext,
      req.user
    );

    // Add AI response
    messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date().toISOString()
    });

    // Update session
    await pool.query(
      `UPDATE onboarding_chats
       SET messages = $1, last_activity = NOW()
       WHERE id = $2`,
      [JSON.stringify(messages), sessionId]
    );

    res.json({ response: aiResponse, session_id: sessionId });
  } catch (err) {
    console.error('Error in assistant chat:', err);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Get chat history
router.get('/assistant/history/:session_id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM onboarding_chats
       WHERE id = $1 AND candidate_id = $2`,
      [req.params.session_id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching chat history:', err);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function analyzeFeedbackWithAI(responses, comments) {
  try {
    const prompt = `Analyze this employee feedback and provide insights:

Responses: ${JSON.stringify(responses)}
Comments: ${comments}

Provide:
1. Sentiment (positive/neutral/negative)
2. Key themes identified
3. Action items for management
4. Risk level (low/medium/high) if negative patterns detected`;

    const analysis = await polsiaAI.chat([
      { role: 'user', content: prompt }
    ], { max_tokens: 1024 });

    return { analysis: analysis, analyzed_at: new Date().toISOString() };
  } catch (err) {
    console.error('Error analyzing feedback:', err);
    return { error: 'Analysis failed' };
  }
}

async function getOnboardingAssistantResponse(messages, policyContext, user) {
  try {
    const systemPrompt = `You are an onboarding assistant for new employees. You help them understand company policies, complete paperwork, and answer questions about their first days.

Company Policies and Information:
${policyContext}

Employee name: ${user.name || 'there'}

Be friendly, helpful, and direct. If you don't know something, say so and suggest they contact HR.`;

    const response = await polsiaAI.chat([
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ], { max_tokens: 512 });

    return response;
  } catch (err) {
    console.error('Error getting AI response:', err);
    return "I'm having trouble connecting right now. Please try again or contact HR directly.";
  }
}

module.exports = router;
