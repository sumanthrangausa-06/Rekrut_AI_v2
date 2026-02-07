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

    // Auto-create employee record for payroll (bridges hiring → payroll pipeline)
    try {
      const empNum = 'EMP-' + String(offer.candidate_id).padStart(4, '0');
      const empResult = await pool.query(`
        INSERT INTO employees (user_id, employer_id, company_id, employee_number, position, employment_type, start_date, status)
        VALUES ($1, $2, $3, $4, $5, 'full-time', $6, 'active')
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        offer.candidate_id,
        offer.recruiter_id,
        offer.company_id,
        empNum,
        offer.title,
        offer.start_date || new Date()
      ]);

      if (empResult.rows.length > 0) {
        const annualSalary = parseFloat(offer.salary || 50000);
        await pool.query(`
          INSERT INTO payroll_configs (employee_id, salary_type, salary_amount, pay_frequency, payment_method, tax_filing_status)
          VALUES ($1, 'salary', $2, 'bi-weekly', 'direct_deposit', 'single')
          ON CONFLICT (employee_id) DO NOTHING
        `, [empResult.rows[0].id, annualSalary]);
      }
    } catch (empErr) {
      console.error('Auto-create employee record failed (non-blocking):', empErr.message);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error accepting offer:', err);
    res.status(500).json({ error: 'Failed to accept offer' });
  }
});

// Withdraw offer (recruiter-side)
router.post('/offers/:id/withdraw', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE offers
       SET status = 'withdrawn', updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status IN ('draft', 'sent', 'viewed')
       RETURNING *`,
      [req.params.id, req.user.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found or cannot be withdrawn' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error withdrawing offer:', err);
    res.status(500).json({ error: 'Failed to withdraw offer' });
  }
});

// Decline offer
router.post('/offers/:id/decline', authMiddleware, async (req, res) => {
  try {
    const { reason, decline_reason } = req.body;

    const result = await pool.query(
      `UPDATE offers
       SET status = 'declined', declined_at = NOW(), decline_reason = $3, updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2
       RETURNING *`,
      [req.params.id, req.user.id, decline_reason || reason || null]
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
// RECRUITER - ONBOARDING DOCUMENTS VISIBILITY
// ============================================

// Get all onboarding documents for recruiter's company (all candidates)
router.get('/recruiter/documents', authMiddleware, async (req, res) => {
  try {
    // Verify user is a recruiter with company_id
    if (!req.user.company_id) {
      return res.status(403).json({ error: 'Only recruiters can view onboarding documents' });
    }

    const result = await pool.query(
      `SELECT
        od.*,
        u.name as candidate_name,
        u.email as candidate_email,
        oc.title as checklist_title,
        oc.status as checklist_status,
        oc.due_date
      FROM onboarding_documents od
      JOIN users u ON od.candidate_id = u.id
      LEFT JOIN onboarding_checklists oc ON od.checklist_id = oc.id
      WHERE od.company_id = $1 OR oc.offer_id IN (
        SELECT id FROM offers WHERE company_id = $2
      )
      ORDER BY od.created_at DESC`,
      [req.user.company_id, req.user.company_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching recruiter onboarding documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get onboarding documents for a specific candidate (recruiter view)
router.get('/recruiter/candidate/:candidate_id/documents', authMiddleware, async (req, res) => {
  try {
    // Verify user is a recruiter
    if (!req.user.company_id) {
      return res.status(403).json({ error: 'Only recruiters can view onboarding documents' });
    }

    // Verify candidate is associated with recruiter's company
    const candidateCheck = await pool.query(
      `SELECT id FROM offers WHERE candidate_id = $1 AND company_id = $2 LIMIT 1`,
      [req.params.candidate_id, req.user.company_id]
    );

    if (candidateCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Candidate not associated with your company' });
    }

    const result = await pool.query(
      `SELECT od.*, od.document_content, od.signer_ip, od.signer_user_agent,
        u.name as candidate_name,
        u.email as candidate_email,
        oc.title as checklist_title,
        oc.status as checklist_status,
        oc.due_date,
        o.salary,
        o.start_date,
        j.title as job_title
      FROM onboarding_documents od
      JOIN users u ON od.candidate_id = u.id
      LEFT JOIN onboarding_checklists oc ON od.checklist_id = oc.id
      LEFT JOIN offers o ON oc.offer_id = o.id
      LEFT JOIN jobs j ON o.job_id = j.id
      WHERE od.candidate_id = $1
      ORDER BY od.created_at DESC`,
      [req.params.candidate_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching candidate onboarding documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get onboarding summary for recruiter dashboard (candidates with pending docs)
router.get('/recruiter/summary', authMiddleware, async (req, res) => {
  try {
    // Verify user is a recruiter
    if (!req.user.company_id) {
      return res.status(403).json({ error: 'Only recruiters can view onboarding documents' });
    }

    const result = await pool.query(
      `SELECT
        u.id as candidate_id,
        u.name as candidate_name,
        u.email as candidate_email,
        COUNT(od.id) as total_documents,
        SUM(CASE WHEN od.status = 'completed' OR od.signed_at IS NOT NULL THEN 1 ELSE 0 END) as signed_documents,
        MAX(od.created_at) as last_activity,
        oc.status as checklist_status,
        oc.due_date,
        j.title as job_title,
        cod.wizard_status,
        cod.current_step as wizard_step
      FROM users u
      JOIN offers o ON u.id = o.candidate_id
      LEFT JOIN onboarding_checklists oc ON u.id = oc.candidate_id
      LEFT JOIN onboarding_documents od ON u.id = od.candidate_id
      LEFT JOIN jobs j ON o.job_id = j.id
      LEFT JOIN candidate_onboarding_data cod ON u.id = cod.candidate_id AND cod.checklist_id = oc.id
      WHERE o.company_id = $1 AND o.status IN ('accepted', 'completed')
      GROUP BY u.id, u.name, u.email, oc.status, oc.due_date, j.title, cod.wizard_status, cod.current_step
      ORDER BY u.created_at DESC`,
      [req.user.company_id]
    );

    // Derive real status from actual document progress (not checklist which may be fake-completed)
    const candidates = result.rows.map(r => {
      const totalDocs = parseInt(r.total_documents) || 0;
      const signedDocs = parseInt(r.signed_documents) || 0;
      let onboarding_status;

      if (r.wizard_status === 'completed' && totalDocs > 0 && signedDocs === totalDocs) {
        onboarding_status = 'completed';
      } else if (totalDocs > 0 || r.wizard_step > 1) {
        onboarding_status = 'in_progress';
      } else {
        onboarding_status = 'pending';
      }

      return {
        candidate_id: r.candidate_id,
        candidate_name: r.candidate_name,
        candidate_email: r.candidate_email,
        total_documents: r.total_documents,
        signed_documents: r.signed_documents,
        last_activity: r.last_activity,
        onboarding_status,
        due_date: r.due_date,
        job_title: r.job_title,
        wizard_step: r.wizard_step
      };
    });

    res.json(candidates);
  } catch (err) {
    console.error('Error fetching onboarding summary:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ============================================
// ONBOARDING WIZARD - REAL CANDIDATE FLOW
// ============================================

// Get wizard progress for current candidate
router.get('/wizard/progress', authMiddleware, async (req, res) => {
  try {
    // Get candidate's active checklist
    const checklist = await pool.query(
      `SELECT oc.*, o.title as offer_title, o.company_name, o.salary, o.start_date,
              j.title as job_title
       FROM onboarding_checklists oc
       JOIN offers o ON oc.offer_id = o.id
       LEFT JOIN jobs j ON o.job_id = j.id
       WHERE oc.candidate_id = $1
       ORDER BY oc.created_at DESC LIMIT 1`,
      [req.user.id]
    );

    if (checklist.rows.length === 0) {
      return res.json({ has_onboarding: false });
    }

    const cl = checklist.rows[0];

    // Get or create wizard data
    let wizardData = await pool.query(
      'SELECT * FROM candidate_onboarding_data WHERE candidate_id = $1 AND checklist_id = $2',
      [req.user.id, cl.id]
    );

    if (wizardData.rows.length === 0) {
      // First time visiting the real wizard — create fresh wizard data
      wizardData = await pool.query(
        `INSERT INTO candidate_onboarding_data (candidate_id, checklist_id)
         VALUES ($1, $2)
         RETURNING *`,
        [req.user.id, cl.id]
      );

      // If the old fake auto-complete system marked the checklist as "completed"
      // but no real wizard data exists, reset the checklist so the candidate
      // can go through the real flow
      if (cl.status === 'completed' || cl.status === 'in_progress') {
        const existingDocs = await pool.query(
          'SELECT COUNT(*) as cnt FROM onboarding_documents WHERE candidate_id = $1 AND checklist_id = $2',
          [req.user.id, cl.id]
        );
        if (parseInt(existingDocs.rows[0].cnt) === 0) {
          // No real documents = the old system faked it. Reset.
          await pool.query(
            `UPDATE onboarding_checklists SET
              status = 'in_progress',
              completed_items = '[]'::jsonb,
              completed_at = NULL,
              updated_at = NOW()
             WHERE id = $1`,
            [cl.id]
          );
          cl.status = 'in_progress';
          cl.completed_items = [];
        }
      }
    }

    // Get existing documents
    const documents = await pool.query(
      'SELECT * FROM onboarding_documents WHERE candidate_id = $1 AND checklist_id = $2 ORDER BY created_at',
      [req.user.id, cl.id]
    );

    res.json({
      has_onboarding: true,
      checklist: cl,
      wizard: wizardData.rows[0],
      documents: documents.rows
    });
  } catch (err) {
    console.error('Error getting wizard progress:', err);
    res.status(500).json({ error: 'Failed to get wizard progress' });
  }
});

// Save wizard step data
router.post('/wizard/save-step', authMiddleware, async (req, res) => {
  try {
    const { checklist_id, step, data } = req.body;

    // Verify checklist belongs to this candidate
    const checklist = await pool.query(
      'SELECT * FROM onboarding_checklists WHERE id = $1 AND candidate_id = $2',
      [checklist_id, req.user.id]
    );
    if (checklist.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    // Get company_id from the offer
    const offer = await pool.query(
      'SELECT company_id FROM offers WHERE id = $1',
      [checklist.rows[0].offer_id]
    );
    const companyId = offer.rows.length > 0 ? offer.rows[0].company_id : null;

    let updateFields = {};
    let updateQuery = '';

    if (step === 1) {
      // Personal Information
      updateFields = {
        legal_first_name: data.legal_first_name,
        legal_middle_name: data.legal_middle_name || null,
        legal_last_name: data.legal_last_name,
        date_of_birth: data.date_of_birth,
        ssn_encrypted: data.ssn ? Buffer.from(data.ssn).toString('base64') : null,
        address_line1: data.address_line1,
        address_line2: data.address_line2 || null,
        city: data.city,
        state: data.state,
        zip_code: data.zip_code,
        phone: data.phone
      };
      updateQuery = `
        UPDATE candidate_onboarding_data SET
          legal_first_name = $1, legal_middle_name = $2, legal_last_name = $3,
          date_of_birth = $4, ssn_encrypted = $5,
          address_line1 = $6, address_line2 = $7, city = $8, state = $9, zip_code = $10,
          phone = $11, current_step = GREATEST(current_step, 2),
          steps_completed = CASE WHEN steps_completed @> '"1"'::jsonb THEN steps_completed ELSE steps_completed || '"1"'::jsonb END,
          updated_at = NOW()
        WHERE candidate_id = $12 AND checklist_id = $13
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [
        updateFields.legal_first_name, updateFields.legal_middle_name, updateFields.legal_last_name,
        updateFields.date_of_birth, updateFields.ssn_encrypted,
        updateFields.address_line1, updateFields.address_line2, updateFields.city,
        updateFields.state, updateFields.zip_code, updateFields.phone,
        req.user.id, checklist_id
      ]);

      // Also complete checklist item 1 (I-9 form) since we have the data
      await completeChecklistItem(checklist_id, req.user.id, 1);

      return res.json({ success: true, wizard: result.rows[0] });
    }

    if (step === 2) {
      // Emergency Contact
      updateQuery = `
        UPDATE candidate_onboarding_data SET
          emergency_contact_name = $1, emergency_contact_relationship = $2,
          emergency_contact_phone = $3, emergency_contact_email = $4,
          current_step = GREATEST(current_step, 3),
          steps_completed = CASE WHEN steps_completed @> '"2"'::jsonb THEN steps_completed ELSE steps_completed || '"2"'::jsonb END,
          updated_at = NOW()
        WHERE candidate_id = $5 AND checklist_id = $6
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [
        data.emergency_contact_name, data.emergency_contact_relationship,
        data.emergency_contact_phone, data.emergency_contact_email || null,
        req.user.id, checklist_id
      ]);

      // Complete checklist item 6 (emergency contact)
      await completeChecklistItem(checklist_id, req.user.id, 6);

      return res.json({ success: true, wizard: result.rows[0] });
    }

    if (step === 3) {
      // Banking / Direct Deposit + W-4 Filing Status
      updateQuery = `
        UPDATE candidate_onboarding_data SET
          bank_name = $1,
          routing_number_encrypted = $2,
          account_number_encrypted = $3,
          account_type = $4,
          w4_filing_status = $5,
          current_step = GREATEST(current_step, 4),
          steps_completed = CASE WHEN steps_completed @> '"3"'::jsonb THEN steps_completed ELSE steps_completed || '"3"'::jsonb END,
          updated_at = NOW()
        WHERE candidate_id = $6 AND checklist_id = $7
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [
        data.bank_name,
        data.routing_number ? Buffer.from(data.routing_number).toString('base64') : null,
        data.account_number ? Buffer.from(data.account_number).toString('base64') : null,
        data.account_type,
        data.w4_filing_status || 'single',
        req.user.id, checklist_id
      ]);

      // Complete checklist item 3 (direct deposit)
      await completeChecklistItem(checklist_id, req.user.id, 3);

      return res.json({ success: true, wizard: result.rows[0] });
    }

    res.status(400).json({ error: 'Invalid step' });
  } catch (err) {
    console.error('Error saving wizard step:', err);
    res.status(500).json({ error: 'Failed to save step data' });
  }
});

// Generate documents from collected data
router.post('/wizard/generate-documents', authMiddleware, async (req, res) => {
  try {
    const { checklist_id } = req.body;

    // Get wizard data
    const wizardData = await pool.query(
      'SELECT * FROM candidate_onboarding_data WHERE candidate_id = $1 AND checklist_id = $2',
      [req.user.id, checklist_id]
    );

    if (wizardData.rows.length === 0) {
      return res.status(404).json({ error: 'No onboarding data found' });
    }

    const wd = wizardData.rows[0];

    // Get offer details for the documents
    const checklist = await pool.query(
      `SELECT oc.*, o.company_name, o.title as offer_title, o.salary, o.start_date
       FROM onboarding_checklists oc
       JOIN offers o ON oc.offer_id = o.id
       WHERE oc.id = $1 AND oc.candidate_id = $2`,
      [checklist_id, req.user.id]
    );

    if (checklist.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    const cl = checklist.rows[0];
    const companyId = cl.company_id || null;

    // Get company_id from the offer
    const offer = await pool.query(
      'SELECT company_id FROM offers WHERE id = $1',
      [cl.offer_id]
    );
    const offerCompanyId = offer.rows.length > 0 ? offer.rows[0].company_id : null;

    const fullName = [wd.legal_first_name, wd.legal_middle_name, wd.legal_last_name]
      .filter(Boolean).join(' ');

    const documents = [];

    // Generate I-9 Form
    const i9Content = {
      form_type: 'I-9',
      employee_name: fullName,
      first_name: wd.legal_first_name,
      middle_name: wd.legal_middle_name,
      last_name: wd.legal_last_name,
      date_of_birth: wd.date_of_birth,
      address: `${wd.address_line1}${wd.address_line2 ? ', ' + wd.address_line2 : ''}`,
      city: wd.city,
      state: wd.state,
      zip: wd.zip_code,
      ssn_last_four: wd.ssn_encrypted ? '****' : 'N/A',
      generated_at: new Date().toISOString(),
      company: cl.company_name
    };

    const i9 = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'I-9 Employment Eligibility', i9Content,
      `I-9 form for ${fullName} - ${cl.company_name}`
    );
    documents.push(i9);

    // Generate W-4 Form
    const w4Content = {
      form_type: 'W-4',
      employee_name: fullName,
      first_name: wd.legal_first_name,
      last_name: wd.legal_last_name,
      ssn_last_four: wd.ssn_encrypted ? '****' : 'N/A',
      address: `${wd.address_line1}${wd.address_line2 ? ', ' + wd.address_line2 : ''}`,
      city_state_zip: `${wd.city}, ${wd.state} ${wd.zip_code}`,
      filing_status: wd.w4_filing_status || 'single',
      generated_at: new Date().toISOString(),
      company: cl.company_name
    };

    const w4 = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'W-4 Tax Withholding', w4Content,
      `W-4 form for ${fullName} - ${cl.company_name}`
    );
    documents.push(w4);

    // Generate Direct Deposit Authorization
    const ddContent = {
      form_type: 'Direct Deposit Authorization',
      employee_name: fullName,
      bank_name: wd.bank_name,
      routing_last_four: wd.routing_number_encrypted ? '****' : 'N/A',
      account_last_four: wd.account_number_encrypted ? '****' : 'N/A',
      account_type: wd.account_type,
      generated_at: new Date().toISOString(),
      company: cl.company_name
    };

    const dd = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'Direct Deposit Authorization', ddContent,
      `Direct deposit form for ${fullName} - ${cl.company_name}`
    );
    documents.push(dd);

    // Generate Employee Handbook Acknowledgment
    const handbookContent = {
      form_type: 'Employee Handbook Acknowledgment',
      employee_name: fullName,
      generated_at: new Date().toISOString(),
      company: cl.company_name,
      acknowledgment_text: `I, ${fullName}, acknowledge that I have received and read the employee handbook for ${cl.company_name}. I understand the policies and agree to abide by them.`
    };

    const handbook = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'Employee Handbook Acknowledgment', handbookContent,
      `Handbook acknowledgment for ${fullName}`
    );
    documents.push(handbook);

    // Complete checklist items for W-4 and handbook
    await completeChecklistItem(checklist_id, req.user.id, 4); // W-4
    await completeChecklistItem(checklist_id, req.user.id, 5); // handbook

    res.json({ success: true, documents });
  } catch (err) {
    console.error('Error generating documents:', err);
    res.status(500).json({ error: 'Failed to generate documents' });
  }
});

// E-sign a document
router.post('/wizard/sign-document', authMiddleware, async (req, res) => {
  try {
    const { document_id, signature_data } = req.body;
    const signerIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const signerUserAgent = req.headers['user-agent'] || 'unknown';

    // Verify document belongs to this candidate
    const doc = await pool.query(
      'SELECT * FROM onboarding_documents WHERE id = $1 AND candidate_id = $2',
      [document_id, req.user.id]
    );

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.rows[0].signed_at) {
      return res.json({ success: true, message: 'Already signed', document: doc.rows[0] });
    }

    const result = await pool.query(
      `UPDATE onboarding_documents SET
        status = 'completed',
        signed_at = NOW(),
        signature_data = $1,
        signer_ip = $2,
        signer_user_agent = $3,
        content_summary = COALESCE(content_summary, '') || ' [Signed by candidate]'
       WHERE id = $4 AND candidate_id = $5
       RETURNING *`,
      [signature_data, signerIp, signerUserAgent, document_id, req.user.id]
    );

    res.json({ success: true, document: result.rows[0] });
  } catch (err) {
    console.error('Error signing document:', err);
    res.status(500).json({ error: 'Failed to sign document' });
  }
});

// Sign all documents at once
router.post('/wizard/sign-all', authMiddleware, async (req, res) => {
  try {
    const { checklist_id, signature_data } = req.body;
    const signerIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const signerUserAgent = req.headers['user-agent'] || 'unknown';

    const result = await pool.query(
      `UPDATE onboarding_documents SET
        status = 'completed',
        signed_at = NOW(),
        signature_data = $1,
        signer_ip = $2,
        signer_user_agent = $3
       WHERE checklist_id = $4 AND candidate_id = $5 AND signed_at IS NULL
       RETURNING *`,
      [signature_data, signerIp, signerUserAgent, checklist_id, req.user.id]
    );

    // Complete remaining checklist items
    await completeChecklistItem(checklist_id, req.user.id, 2); // Upload ID
    await completeChecklistItem(checklist_id, req.user.id, 7); // IT setup
    await completeChecklistItem(checklist_id, req.user.id, 8); // Orientation

    // Mark wizard as completed
    await pool.query(
      `UPDATE candidate_onboarding_data SET
        wizard_status = 'completed',
        current_step = 5,
        steps_completed = CASE WHEN steps_completed @> '"4"'::jsonb THEN steps_completed ELSE steps_completed || '"4"'::jsonb END,
        completed_at = NOW(),
        updated_at = NOW()
       WHERE candidate_id = $1 AND checklist_id = $2`,
      [req.user.id, checklist_id]
    );

    // Mark checklist as completed
    await pool.query(
      `UPDATE onboarding_checklists SET
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2`,
      [checklist_id, req.user.id]
    );

    res.json({ success: true, signed_documents: result.rows });
  } catch (err) {
    console.error('Error signing all documents:', err);
    res.status(500).json({ error: 'Failed to sign documents' });
  }
});

// Get candidate's documents for the wizard
router.get('/wizard/documents/:checklist_id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM onboarding_documents
       WHERE checklist_id = $1 AND candidate_id = $2
       ORDER BY created_at`,
      [req.params.checklist_id, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching wizard documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// ============================================
// DOCUMENT DOWNLOAD (RECRUITER)
// ============================================

// Download/export a document as printable HTML
router.get('/recruiter/document/:document_id/download', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(403).json({ error: 'Only recruiters can download documents' });
    }

    const doc = await pool.query(
      `SELECT od.*, u.name as candidate_name, u.email as candidate_email
       FROM onboarding_documents od
       JOIN users u ON od.candidate_id = u.id
       WHERE od.id = $1`,
      [req.params.document_id]
    );

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const d = doc.rows[0];

    // Verify access: document must belong to a candidate from this recruiter's company
    const offerCheck = await pool.query(
      `SELECT id FROM offers WHERE candidate_id = $1 AND company_id = $2 LIMIT 1`,
      [d.candidate_id, req.user.company_id]
    );
    if (offerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const content = typeof d.document_content === 'string'
      ? JSON.parse(d.document_content)
      : (d.document_content || {});

    // Generate printable HTML document
    const html = generatePrintableDocument(d, content);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="${d.document_type.replace(/[^a-zA-Z0-9]/g, '_')}_${d.candidate_name.replace(/[^a-zA-Z0-9]/g, '_')}.html"`);
    res.send(html);
  } catch (err) {
    console.error('Error downloading document:', err);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

// Get document JSON content for recruiter (for API consumers)
router.get('/recruiter/document/:document_id/json', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(403).json({ error: 'Only recruiters can access documents' });
    }

    const doc = await pool.query(
      `SELECT od.*, u.name as candidate_name, u.email as candidate_email
       FROM onboarding_documents od
       JOIN users u ON od.candidate_id = u.id
       WHERE od.id = $1`,
      [req.params.document_id]
    );

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const d = doc.rows[0];
    const offerCheck = await pool.query(
      `SELECT id FROM offers WHERE candidate_id = $1 AND company_id = $2 LIMIT 1`,
      [d.candidate_id, req.user.company_id]
    );
    if (offerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(d);
  } catch (err) {
    console.error('Error fetching document JSON:', err);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// Helper: Generate printable HTML document
function generatePrintableDocument(doc, content) {
  const signedInfo = doc.signed_at
    ? `<div class="signature-block">
        <p><strong>Electronically Signed</strong></p>
        <p>Signed by: ${escapeHtmlServer(doc.candidate_name)}</p>
        <p>Date: ${new Date(doc.signed_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'medium' })}</p>
        <p>IP Address: ${escapeHtmlServer(doc.signer_ip || 'N/A')}</p>
       </div>`
    : '<p class="pending">⏳ Awaiting Signature</p>';

  let bodyContent = '';

  if (content.form_type === 'I-9') {
    bodyContent = `
      <div class="form-header">
        <h2>Employment Eligibility Verification</h2>
        <p class="subtitle">Department of Homeland Security — U.S. Citizenship and Immigration Services</p>
        <p class="form-id">Form I-9</p>
      </div>
      <div class="section">
        <h3>Section 1: Employee Information</h3>
        <table>
          <tr><td class="label">Full Legal Name:</td><td>${escapeHtmlServer(content.employee_name || '')}</td></tr>
          <tr><td class="label">First Name:</td><td>${escapeHtmlServer(content.first_name || '')}</td></tr>
          <tr><td class="label">Middle Name:</td><td>${escapeHtmlServer(content.middle_name || 'N/A')}</td></tr>
          <tr><td class="label">Last Name:</td><td>${escapeHtmlServer(content.last_name || '')}</td></tr>
          <tr><td class="label">Date of Birth:</td><td>${content.date_of_birth ? new Date(content.date_of_birth).toLocaleDateString('en-US') : 'N/A'}</td></tr>
          <tr><td class="label">Address:</td><td>${escapeHtmlServer(content.address || '')}</td></tr>
          <tr><td class="label">City:</td><td>${escapeHtmlServer(content.city || '')}</td></tr>
          <tr><td class="label">State:</td><td>${escapeHtmlServer(content.state || '')}</td></tr>
          <tr><td class="label">ZIP:</td><td>${escapeHtmlServer(content.zip || '')}</td></tr>
          <tr><td class="label">SSN (masked):</td><td>${content.ssn_last_four || '****'}</td></tr>
          <tr><td class="label">Employer:</td><td>${escapeHtmlServer(content.company || '')}</td></tr>
        </table>
      </div>
    `;
  } else if (content.form_type === 'W-4') {
    bodyContent = `
      <div class="form-header">
        <h2>Employee's Withholding Certificate</h2>
        <p class="subtitle">Department of the Treasury — Internal Revenue Service</p>
        <p class="form-id">Form W-4</p>
      </div>
      <div class="section">
        <h3>Employee Information</h3>
        <table>
          <tr><td class="label">Full Name:</td><td>${escapeHtmlServer(content.employee_name || '')}</td></tr>
          <tr><td class="label">SSN (masked):</td><td>${content.ssn_last_four || '****'}</td></tr>
          <tr><td class="label">Address:</td><td>${escapeHtmlServer(content.address || '')}</td></tr>
          <tr><td class="label">City, State, ZIP:</td><td>${escapeHtmlServer(content.city_state_zip || '')}</td></tr>
          <tr><td class="label">Filing Status:</td><td>${escapeHtmlServer(content.filing_status || 'Single')}</td></tr>
        </table>
      </div>
    `;
  } else if (content.form_type === 'Direct Deposit Authorization') {
    bodyContent = `
      <div class="form-header">
        <h2>Direct Deposit Authorization</h2>
        <p class="subtitle">Payroll Direct Deposit Setup</p>
      </div>
      <div class="section">
        <h3>Employee Banking Information</h3>
        <table>
          <tr><td class="label">Employee Name:</td><td>${escapeHtmlServer(content.employee_name || '')}</td></tr>
          <tr><td class="label">Bank Name:</td><td>${escapeHtmlServer(content.bank_name || '')}</td></tr>
          <tr><td class="label">Routing Number (masked):</td><td>${content.routing_last_four || '****'}</td></tr>
          <tr><td class="label">Account Number (masked):</td><td>${content.account_last_four || '****'}</td></tr>
          <tr><td class="label">Account Type:</td><td>${escapeHtmlServer(content.account_type || '')}</td></tr>
        </table>
        <p class="authorization">I hereby authorize my employer to deposit my pay directly into the bank account listed above. This authorization remains in effect until I provide written notice of cancellation.</p>
      </div>
    `;
  } else if (content.form_type === 'Employee Handbook Acknowledgment') {
    bodyContent = `
      <div class="form-header">
        <h2>Employee Handbook Acknowledgment</h2>
        <p class="subtitle">${escapeHtmlServer(content.company || '')} — Employee Agreement</p>
      </div>
      <div class="section">
        <p class="authorization">${escapeHtmlServer(content.acknowledgment_text || '')}</p>
      </div>
    `;
  } else {
    bodyContent = `<pre>${JSON.stringify(content, null, 2)}</pre>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtmlServer(doc.document_type)} — ${escapeHtmlServer(doc.candidate_name)}</title>
  <style>
    @media print { body { margin: 0.5in; } .no-print { display: none; } }
    body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.6; }
    .form-header { text-align: center; margin-bottom: 32px; border-bottom: 2px solid #111; padding-bottom: 16px; }
    .form-header h2 { font-size: 22px; margin-bottom: 4px; }
    .form-header .subtitle { font-size: 14px; color: #444; }
    .form-header .form-id { font-weight: bold; font-size: 16px; margin-top: 8px; }
    .section { margin-bottom: 24px; }
    .section h3 { font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 4px; border-bottom: 1px solid #eee; font-size: 14px; }
    .label { font-weight: bold; width: 200px; color: #333; }
    .signature-block { margin-top: 32px; padding: 16px; border: 1px solid #ccc; border-radius: 4px; background: #f9f9f9; }
    .signature-block p { margin: 4px 0; font-size: 13px; }
    .pending { color: #b45309; font-style: italic; margin-top: 24px; }
    .authorization { font-style: italic; margin-top: 16px; padding: 16px; background: #f5f5f5; border-radius: 4px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ccc; font-size: 12px; color: #666; }
    .no-print { margin-bottom: 24px; text-align: center; }
    .no-print button { padding: 10px 24px; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 0 8px; }
    .no-print button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨️ Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  ${bodyContent}
  ${signedInfo}
  <div class="footer">
    <p>Generated: ${content.generated_at ? new Date(content.generated_at).toLocaleString('en-US') : new Date().toLocaleString('en-US')}</p>
    <p>Document ID: ${doc.id} | Candidate: ${escapeHtmlServer(doc.candidate_name)} (${escapeHtmlServer(doc.candidate_email)})</p>
  </div>
</body>
</html>`;
}

function escapeHtmlServer(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Helper: upsert a document
async function upsertDocument(checklistId, candidateId, companyId, docType, content, summary) {
  // Check if already exists
  const existing = await pool.query(
    'SELECT * FROM onboarding_documents WHERE checklist_id = $1 AND candidate_id = $2 AND document_type = $3',
    [checklistId, candidateId, docType]
  );

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE onboarding_documents SET
        document_content = $1, content_summary = $2, status = 'pending', uploaded_at = NOW()
       WHERE id = $3 RETURNING *`,
      [JSON.stringify(content), summary, existing.rows[0].id]
    );
    return updated.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO onboarding_documents
     (checklist_id, candidate_id, company_id, document_type, document_content, content_summary, status, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
     RETURNING *`,
    [checklistId, candidateId, companyId, docType, JSON.stringify(content), summary]
  );
  return result.rows[0];
}

// Helper: complete a checklist item
async function completeChecklistItem(checklistId, candidateId, itemId) {
  try {
    const checklist = await pool.query(
      'SELECT * FROM onboarding_checklists WHERE id = $1 AND candidate_id = $2',
      [checklistId, candidateId]
    );
    if (checklist.rows.length === 0) return;

    const completedItems = checklist.rows[0].completed_items || [];
    if (!completedItems.includes(itemId)) {
      completedItems.push(itemId);
    }

    const items = checklist.rows[0].items || [];
    const allCompleted = items.every(item => completedItems.includes(item.id));

    await pool.query(
      `UPDATE onboarding_checklists SET
        completed_items = $1,
        status = $2,
        completed_at = $3,
        updated_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify(completedItems),
        allCompleted ? 'completed' : 'in_progress',
        allCompleted ? new Date() : null,
        checklistId
      ]
    );
  } catch (err) {
    console.error('Error completing checklist item:', err);
  }
}

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
