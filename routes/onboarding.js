const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const polsiaAI = require('../lib/polsia-ai');
const countryConfig = require('../services/country-config');

// ============================================
// OFFER GENERATION
// ============================================

// Create offer
router.post('/offers', authMiddleware, async (req, res) => {
  try {
    const { candidate_id, job_id, salary, start_date, benefits, template_data,
            reporting_to, location, employment_type } = req.body;
    // title can come from body or be derived from the job
    let title = req.body.title;

    if (!candidate_id || !job_id) {
      return res.status(400).json({ error: 'candidate_id and job_id are required' });
    }

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1 AND company_id = $2', [job_id, req.user.company_id]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Default title to job title if not provided
    if (!title || !title.trim()) {
      title = job.rows[0].title || 'Employment Offer';
    }

    const result = await pool.query(
      `INSERT INTO offers (
        candidate_id, job_id, recruiter_id, company_id, title, company_name,
        salary, start_date, benefits, template_data, reporting_to, location,
        employment_type, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [candidate_id, job_id, req.user.id, req.user.company_id, title, job.rows[0].company || 'Rekrut AI',
       parseFloat(salary) || 0, start_date, benefits, JSON.stringify(template_data || {}),
       reporting_to || null, location || job.rows[0].location || null,
       employment_type || 'full-time', 'draft']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// AI-generate professional offer letter
router.post('/offers/:id/generate-letter', authMiddleware, async (req, res) => {
  try {
    // Get offer with all related data
    const offerResult = await pool.query(
      `SELECT o.*,
        u.name as candidate_name,
        u.email as candidate_email,
        j.title as job_title,
        j.description as job_description,
        j.location as job_location,
        r.name as recruiter_name
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      LEFT JOIN jobs j ON o.job_id = j.id
      LEFT JOIN users r ON o.recruiter_id = r.id
      WHERE o.id = $1 AND o.company_id = $2`,
      [req.params.id, req.user.company_id]
    );

    if (offerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const offer = offerResult.rows[0];

    const prompt = `Generate a professional, formal employment offer letter. Return ONLY the HTML content (no markdown, no code fences). Use clean, semantic HTML with inline styles for professional formatting.

OFFER DETAILS:
- Company Name: ${offer.company_name || 'The Company'}
- Candidate Name: ${offer.candidate_name}
- Job Title: ${offer.job_title || offer.title}
- Annual Salary: $${Number(offer.salary).toLocaleString()}
- Start Date: ${offer.start_date ? new Date(offer.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'To be determined'}
- Employment Type: ${offer.employment_type || 'Full-time'}
- Location: ${offer.location || offer.job_location || 'To be discussed'}
- Reporting To: ${offer.reporting_to || 'Department Manager'}
- Benefits: ${offer.benefits || 'Standard company benefits package'}
- Recruiter/HR Contact: ${offer.recruiter_name || 'HR Department'}

REQUIREMENTS:
1. Professional business letter format with company letterhead area at top
2. Today's date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
3. Formal greeting to the candidate by name
4. Opening paragraph expressing excitement about extending the offer
5. Position details section (title, department, reporting structure, start date)
6. Compensation section (salary, pay frequency)
7. Benefits section (list the provided benefits professionally)
8. Employment terms (at-will employment, contingencies like background check)
9. Acceptance section with a placeholder line for signature and date
10. Warm closing from the company
11. Use inline CSS styles for clean formatting (the HTML will be rendered directly)
12. Use a professional color scheme (dark navy #1e3a5f for headers, #333 for body text)
13. Include proper spacing, margins, and a clean border/outline for the document
14. The document should look like a real PDF offer letter when rendered

FORMAT RULES:
- Wrap everything in a single <div> with max-width: 800px and margin: 0 auto
- Use a subtle border and padding to frame the letter
- Company name at top should be bold and prominent
- Include horizontal rules to separate sections
- The signature block should have clear lines for name, signature, and date`;

    const letterHtml = await polsiaAI.chat(prompt, {
      system: 'You are an expert HR document writer. Generate professional, legally appropriate employment offer letters. Return ONLY clean HTML with inline styles. No markdown, no code blocks, no explanations.',
      module: 'onboarding', feature: 'offer_letter'
    });

    // Clean up any accidental code fences
    let cleanHtml = letterHtml.trim();
    if (cleanHtml.startsWith('```')) {
      cleanHtml = cleanHtml.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
    }

    // Store the generated letter
    await pool.query(
      `UPDATE offers SET
        offer_letter_html = $1,
        offer_letter_generated_at = NOW(),
        updated_at = NOW()
      WHERE id = $2`,
      [cleanHtml, req.params.id]
    );

    res.json({
      success: true,
      offer_letter_html: cleanHtml,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error generating offer letter:', err);
    res.status(500).json({ error: 'Failed to generate offer letter' });
  }
});

// Get offer letter HTML for viewing
router.get('/offers/:id/letter', authMiddleware, async (req, res) => {
  try {
    // Allow both recruiter (company_id match) and candidate (candidate_id match)
    const result = await pool.query(
      `SELECT offer_letter_html, offer_letter_generated_at, status, candidate_signature, candidate_signed_at
       FROM offers
       WHERE id = $1 AND (company_id = $2 OR candidate_id = $2)`,
      [req.params.id, req.user.company_id || req.user.id]
    );

    if (result.rows.length === 0) {
      // Try candidate match specifically
      const candidateResult = await pool.query(
        `SELECT offer_letter_html, offer_letter_generated_at, status, candidate_signature, candidate_signed_at
         FROM offers WHERE id = $1 AND candidate_id = $2`,
        [req.params.id, req.user.id]
      );
      if (candidateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Offer not found' });
      }
      return res.json(candidateResult.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching offer letter:', err);
    res.status(500).json({ error: 'Failed to fetch offer letter' });
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
        r.name as recruiter_name,
        CASE WHEN o.offer_letter_html IS NOT NULL THEN true ELSE false END as has_letter
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
        j.company,
        CASE WHEN o.offer_letter_html IS NOT NULL THEN true ELSE false END as has_letter
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
       SET viewed_at = COALESCE(viewed_at, NOW()),
           status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
           updated_at = NOW()
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

// Accept offer (with e-signature)
router.post('/offers/:id/accept', authMiddleware, async (req, res) => {
  try {
    const { signature_url, signature_data } = req.body;
    const signerIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

    const result = await pool.query(
      `UPDATE offers
       SET status = 'accepted', accepted_at = NOW(), signature_url = $3,
           candidate_signature = $4, candidate_signed_at = NOW(), candidate_sign_ip = $5,
           updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2
       RETURNING *`,
      [req.params.id, req.user.id, signature_url, signature_data || null, signerIp]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Create country-aware onboarding checklist
    const offer = result.rows[0];

    // Determine country from the offer/job
    let offerCountryCode = offer.country_code || 'US';
    if (!offer.country_code) {
      // Try to get from job
      try {
        const jobCountry = await pool.query('SELECT country_code FROM jobs WHERE id = $1', [offer.job_id]);
        if (jobCountry.rows.length > 0 && jobCountry.rows[0].country_code) {
          offerCountryCode = jobCountry.rows[0].country_code;
        }
      } catch (e) { /* fallback to US */ }
    }

    // Get country-specific checklist items
    let defaultItems;
    const COUNTRY_CHECKLIST_ITEMS = {
      US: [
        { id: 1, task: 'Complete I-9 form (Employment Eligibility)', required: true },
        { id: 2, task: 'Upload government-issued ID', required: true },
        { id: 3, task: 'Set up direct deposit', required: true },
        { id: 4, task: 'Complete tax withholding (W-4)', required: true },
        { id: 5, task: 'Sign employee handbook acknowledgment', required: true },
        { id: 6, task: 'Submit emergency contact information', required: true },
        { id: 7, task: 'Complete IT setup (email, laptop)', required: false },
        { id: 8, task: 'Schedule first day orientation', required: true },
      ],
      IN: [
        { id: 1, task: 'Submit PAN card details', required: true },
        { id: 2, task: 'Submit Aadhaar verification', required: true },
        { id: 3, task: 'Complete PF Form 11 declaration', required: true },
        { id: 4, task: 'Submit PF nomination (Form 2)', required: true },
        { id: 5, task: 'Complete ESI form (if applicable)', required: false },
        { id: 6, task: 'Submit gratuity nomination (Form F)', required: true },
        { id: 7, task: 'Provide bank account details', required: true },
        { id: 8, task: 'Sign employee handbook acknowledgment', required: true },
        { id: 9, task: 'Submit emergency contact information', required: true },
      ],
      GB: [
        { id: 1, task: 'Complete Right to Work check', required: true },
        { id: 2, task: 'Submit P45 or Starter Checklist', required: true },
        { id: 3, task: 'Provide National Insurance number', required: true },
        { id: 4, task: 'Provide bank account details', required: true },
        { id: 5, task: 'Sign employee handbook acknowledgment', required: true },
        { id: 6, task: 'Submit emergency contact information', required: true },
      ],
      CA: [
        { id: 1, task: 'Complete TD1 Federal tax credits form', required: true },
        { id: 2, task: 'Complete TD1 Provincial tax credits form', required: true },
        { id: 3, task: 'Provide Social Insurance Number (SIN)', required: true },
        { id: 4, task: 'Provide bank account details', required: true },
        { id: 5, task: 'Sign employee handbook acknowledgment', required: true },
        { id: 6, task: 'Submit emergency contact information', required: true },
      ],
      DE: [
        { id: 1, task: 'Sign GDPR data processing consent', required: true },
        { id: 2, task: 'Provide Tax ID (Steuer-ID)', required: true },
        { id: 3, task: 'Submit social insurance details', required: true },
        { id: 4, task: 'Provide work permit (non-EU only)', required: false },
        { id: 5, task: 'Provide IBAN for salary', required: true },
        { id: 6, task: 'Sign employee handbook', required: true },
      ],
    };
    defaultItems = COUNTRY_CHECKLIST_ITEMS[offerCountryCode] || COUNTRY_CHECKLIST_ITEMS['US'];

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

    // Determine country from offer → job → company chain
    const offerCountry = await pool.query(
      `SELECT o.country_code as offer_country, j.country_code as job_country,
              c.primary_country as company_country
       FROM offers o
       LEFT JOIN jobs j ON o.job_id = j.id
       LEFT JOIN companies c ON o.company_id = c.id
       WHERE o.id = $1`,
      [cl.offer_id]
    );

    let employeeCountry = 'US'; // default
    if (offerCountry.rows.length > 0) {
      const oc = offerCountry.rows[0];
      employeeCountry = oc.offer_country || oc.job_country || oc.company_country || 'US';
    }

    // Get country-specific wizard steps
    let wizardSteps = [];
    let countryInfo = null;
    try {
      wizardSteps = await countryConfig.getWizardSteps(employeeCountry);
      countryInfo = await countryConfig.getCountry(employeeCountry);
    } catch (e) {
      console.error('Error loading country config:', e.message);
    }

    res.json({
      has_onboarding: true,
      checklist: cl,
      wizard: wizardData.rows[0],
      documents: documents.rows,
      country_code: employeeCountry,
      country_info: countryInfo ? {
        country_name: countryInfo.country_name,
        currency_code: countryInfo.currency_code,
        currency_symbol: countryInfo.currency_symbol,
        date_format: countryInfo.date_format,
        employment_model: countryInfo.employment_model,
      } : null,
      wizard_steps: wizardSteps,
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
      // Personal Information + I-9 Section 1 Attestation (USCIS Form I-9, Edition 01/20/2025)
      const ssnEncrypted = data.ssn ? Buffer.from(data.ssn).toString('base64') : null;
      updateQuery = `
        UPDATE candidate_onboarding_data SET
          legal_first_name = $1, legal_middle_name = $2, legal_last_name = $3,
          date_of_birth = $4, ssn_encrypted = COALESCE($5, ssn_encrypted),
          address_line1 = $6, address_line2 = $7, city = $8, state = $9, zip_code = $10,
          phone = $11,
          i9_citizenship_status = $12,
          i9_alien_number = $13,
          i9_admission_number = $14,
          i9_passport_number = $15,
          i9_country_of_issuance = $16,
          i9_work_auth_expiry = $17,
          i9_other_last_names = $18,
          i9_email = $19,
          i9_preparer_used = $20,
          current_step = GREATEST(current_step, 2),
          steps_completed = CASE WHEN steps_completed @> '"1"'::jsonb THEN steps_completed ELSE steps_completed || '"1"'::jsonb END,
          updated_at = NOW()
        WHERE candidate_id = $21 AND checklist_id = $22
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [
        data.legal_first_name, data.legal_middle_name || null, data.legal_last_name,
        data.date_of_birth, ssnEncrypted,
        data.address_line1, data.address_line2 || null, data.city,
        data.state, data.zip_code, data.phone,
        data.i9_citizenship_status || 'citizen',
        data.i9_alien_number || null,
        data.i9_admission_number || null,
        data.i9_passport_number || null,
        data.i9_country_of_issuance || null,
        data.i9_work_auth_expiry || null,
        data.i9_other_last_names || null,
        data.i9_email || null,
        data.i9_preparer_used || false,
        req.user.id, checklist_id
      ]);

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
      // Banking / Direct Deposit only
      updateQuery = `
        UPDATE candidate_onboarding_data SET
          bank_name = $1,
          routing_number_encrypted = COALESCE($2, routing_number_encrypted),
          account_number_encrypted = COALESCE($3, account_number_encrypted),
          account_type = $4,
          current_step = GREATEST(current_step, 4),
          steps_completed = CASE WHEN steps_completed @> '"3"'::jsonb THEN steps_completed ELSE steps_completed || '"3"'::jsonb END,
          updated_at = NOW()
        WHERE candidate_id = $5 AND checklist_id = $6
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [
        data.bank_name,
        data.routing_number ? Buffer.from(data.routing_number).toString('base64') : null,
        data.account_number ? Buffer.from(data.account_number).toString('base64') : null,
        data.account_type,
        req.user.id, checklist_id
      ]);

      await completeChecklistItem(checklist_id, req.user.id, 3);
      return res.json({ success: true, wizard: result.rows[0] });
    }

    if (step === 4) {
      // Full W-4 Tax Withholding (IRS Form W-4 Steps 1-4)
      updateQuery = `
        UPDATE candidate_onboarding_data SET
          w4_filing_status = $1,
          w4_multiple_jobs = $2,
          w4_spouse_works = $3,
          w4_num_dependents_under_17 = $4,
          w4_num_other_dependents = $5,
          w4_other_income = $6,
          w4_deductions = $7,
          w4_extra_withholding = $8,
          w4_exempt = $9,
          current_step = GREATEST(current_step, 5),
          steps_completed = CASE WHEN steps_completed @> '"4"'::jsonb THEN steps_completed ELSE steps_completed || '"4"'::jsonb END,
          updated_at = NOW()
        WHERE candidate_id = $10 AND checklist_id = $11
        RETURNING *
      `;
      const result = await pool.query(updateQuery, [
        data.w4_filing_status || 'single',
        data.w4_multiple_jobs || false,
        data.w4_spouse_works || false,
        parseInt(data.w4_num_dependents_under_17) || 0,
        parseInt(data.w4_num_other_dependents) || 0,
        parseFloat(data.w4_other_income) || 0,
        parseFloat(data.w4_deductions) || 0,
        parseFloat(data.w4_extra_withholding) || 0,
        data.w4_exempt || false,
        req.user.id, checklist_id
      ]);

      await completeChecklistItem(checklist_id, req.user.id, 4);
      return res.json({ success: true, wizard: result.rows[0] });
    }

    // ── Country-specific step handling (non-US countries) ──
    // If the save includes country_code and country_specific_data, store in JSONB
    if (data.country_code && data.country_code !== 'US') {
      const cc = data.country_code;
      const csd = data.country_specific_data || {};

      // Merge new country-specific data with existing
      const existing = await pool.query(
        'SELECT country_specific_data, country_code FROM candidate_onboarding_data WHERE candidate_id = $1 AND checklist_id = $2',
        [req.user.id, checklist_id]
      );

      const existingData = existing.rows[0]?.country_specific_data || {};
      const mergedData = { ...existingData, ...csd };

      const result = await pool.query(`
        UPDATE candidate_onboarding_data SET
          country_code = $1,
          country_specific_data = $2,
          legal_first_name = COALESCE($3, legal_first_name),
          legal_last_name = COALESCE($4, legal_last_name),
          date_of_birth = COALESCE($5, date_of_birth),
          phone = COALESCE($6, phone),
          address_line1 = COALESCE($7, address_line1),
          city = COALESCE($8, city),
          emergency_contact_name = COALESCE($9, emergency_contact_name),
          emergency_contact_phone = COALESCE($10, emergency_contact_phone),
          bank_name = COALESCE($11, bank_name),
          current_step = GREATEST(current_step, $12),
          steps_completed = CASE
            WHEN steps_completed @> to_jsonb($13::text)
            THEN steps_completed
            ELSE steps_completed || to_jsonb($13::text)
          END,
          updated_at = NOW()
        WHERE candidate_id = $14 AND checklist_id = $15
        RETURNING *
      `, [
        cc,
        JSON.stringify(mergedData),
        data.legal_first_name || null,
        data.legal_last_name || null,
        data.date_of_birth || null,
        data.phone || null,
        data.address_line1 || null,
        data.city || null,
        data.emergency_contact_name || null,
        data.emergency_contact_phone || null,
        data.bank_name || null,
        step + 1,
        String(step),
        req.user.id,
        checklist_id,
      ]);

      await completeChecklistItem(checklist_id, req.user.id, step);
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

    // ── I-9 Employment Eligibility Verification (USCIS Form I-9, Edition 01/20/2025, OMB No. 1615-0047) ──
    const citizenshipLabels = {
      citizen: 'A citizen of the United States',
      noncitizen_national: 'A noncitizen national of the United States',
      permanent_resident: 'A lawful permanent resident',
      work_authorized: 'An alien authorized to work'
    };

    const i9Content = {
      form_type: 'I-9',
      form_edition: '01/20/2025',
      omb_number: '1615-0047',
      omb_expiry: '05/31/2027',
      employee_name: fullName,
      first_name: wd.legal_first_name,
      middle_initial: wd.legal_middle_name ? wd.legal_middle_name.charAt(0).toUpperCase() : '',
      last_name: wd.legal_last_name,
      other_last_names: wd.i9_other_last_names || 'N/A',
      date_of_birth: wd.date_of_birth,
      address: `${wd.address_line1}${wd.address_line2 ? ', ' + wd.address_line2 : ''}`,
      apt_number: wd.address_line2 || '',
      city: wd.city,
      state: wd.state,
      zip: wd.zip_code,
      ssn_last_four: wd.ssn_encrypted ? '****' : 'N/A',
      email: wd.i9_email || '',
      phone: wd.phone || '',
      citizenship_status: wd.i9_citizenship_status || 'citizen',
      citizenship_label: citizenshipLabels[wd.i9_citizenship_status] || citizenshipLabels.citizen,
      alien_number: wd.i9_alien_number || null,
      admission_number: wd.i9_admission_number || null,
      passport_number: wd.i9_passport_number || null,
      country_of_issuance: wd.i9_country_of_issuance || null,
      work_auth_expiry: wd.i9_work_auth_expiry || null,
      preparer_used: wd.i9_preparer_used || false,
      anti_discrimination_notice: 'It is illegal to discriminate against work-authorized individuals in hiring, firing, recruitment or referral for a fee, or in the employment eligibility verification (Form I-9 and E-Verify) process based on that individual\'s citizenship status, immigration status, or national origin. For more information, call the Immigrant and Employee Rights Section (IER) in the Department of Justice\'s Civil Rights Division at 1-800-255-7688 (employees), 1-800-255-8155 (employers), or 1-800-237-2515 (TTY).',
      perjury_statement: 'I attest, under penalty of perjury, that I am (check one of the following boxes):',
      false_statements_warning: 'I am aware that federal law provides for imprisonment and/or fines for false statements, or the use of false documents, in connection with the completion of this form. I attest, under penalty of perjury, that the information I have provided is true and correct.',
      generated_at: new Date().toISOString(),
      company: cl.company_name
    };

    // Generate AI-formatted I-9 HTML
    let i9Html = null;
    try {
      i9Html = await generateAIDocument('I-9', i9Content, cl.company_name);
    } catch (e) {
      console.error('AI I-9 generation failed, using template:', e.message);
    }

    const i9 = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'I-9 Employment Eligibility', i9Content,
      `I-9 form for ${fullName} - ${cl.company_name}`,
      i9Html
    );
    documents.push(i9);

    // ── W-4 Employee's Withholding Certificate (IRS Form W-4, 2025, OMB No. 1545-0074) ──
    const filingStatusLabels = {
      single: 'Single or Married filing separately',
      married: 'Married filing jointly or Qualifying surviving spouse',
      head_of_household: 'Head of household'
    };

    const dependentCredits = ((parseInt(wd.w4_num_dependents_under_17) || 0) * 2000) +
                             ((parseInt(wd.w4_num_other_dependents) || 0) * 500);

    const w4Content = {
      form_type: 'W-4',
      form_year: '2025',
      omb_number: '1545-0074',
      employee_name: fullName,
      first_name: wd.legal_first_name,
      middle_initial: wd.legal_middle_name ? wd.legal_middle_name.charAt(0).toUpperCase() : '',
      last_name: wd.legal_last_name,
      ssn_last_four: wd.ssn_encrypted ? '****' : 'N/A',
      address: `${wd.address_line1}${wd.address_line2 ? ', ' + wd.address_line2 : ''}`,
      city_state_zip: `${wd.city}, ${wd.state} ${wd.zip_code}`,
      filing_status: wd.w4_filing_status || 'single',
      filing_status_label: filingStatusLabels[wd.w4_filing_status] || filingStatusLabels.single,
      // Step 2: Multiple Jobs or Spouse Works (Option c checkbox)
      multiple_jobs_checkbox: wd.w4_multiple_jobs || false,
      // Step 3: Claim Dependents
      num_dependents_under_17: parseInt(wd.w4_num_dependents_under_17) || 0,
      num_other_dependents: parseInt(wd.w4_num_other_dependents) || 0,
      dependent_credits: dependentCredits,
      child_tax_credit_amount: 2000,
      other_dependent_credit_amount: 500,
      income_threshold_single: 200000,
      income_threshold_married: 400000,
      // Step 4: Other Adjustments
      other_income: parseFloat(wd.w4_other_income) || 0,
      deductions: parseFloat(wd.w4_deductions) || 0,
      extra_withholding: parseFloat(wd.w4_extra_withholding) || 0,
      // Exempt
      exempt: wd.w4_exempt || false,
      exempt_note: 'To claim exemption, employee must have had no federal income tax liability last year and expect none this year. Must submit new W-4 by February 17 of next year.',
      // Employer section (Step 5)
      employer: cl.company_name,
      employer_address: 'On file',
      employer_ein: 'On file',
      first_date_of_employment: cl.start_date ? new Date(cl.start_date).toLocaleDateString('en-US') : 'TBD',
      privacy_act_notice: 'The IRS asks for the information on this form to carry out the Internal Revenue laws of the United States. You are required to give this information to your employer but you do not have to respond to any questions that are not relevant to your tax situation.',
      generated_at: new Date().toISOString(),
      company: cl.company_name
    };

    let w4Html = null;
    try {
      w4Html = await generateAIDocument('W-4', w4Content, cl.company_name);
    } catch (e) {
      console.error('AI W-4 generation failed, using template:', e.message);
    }

    const w4 = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'W-4 Tax Withholding', w4Content,
      `W-4 form for ${fullName} - ${cl.company_name}`,
      w4Html
    );
    documents.push(w4);

    // ── Direct Deposit Authorization ──
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
      `Direct deposit form for ${fullName} - ${cl.company_name}`,
      null
    );
    documents.push(dd);

    // ── AI-Generated Employee Handbook Acknowledgment ──
    let handbookHtml = null;
    try {
      const handbookPrompt = `Generate a professional Employee Handbook Acknowledgment for ${cl.company_name}, employee: ${fullName}. Include: at-will employment, equal opportunity, anti-harassment, confidentiality, code of conduct, tech use policy, attendance, safety, grievance procedures, and acknowledgment statement. Return ONLY HTML with inline styles. Professional format with navy (#1e3a5f) headers.`;
      handbookHtml = await polsiaAI.chat(handbookPrompt, {
        system: 'You are an expert HR document writer. Generate professional, legally appropriate documents. Return ONLY clean HTML with inline styles. No markdown, no code blocks.',
        module: 'onboarding', feature: 'handbook'
      });
      if (handbookHtml.startsWith('```')) {
        handbookHtml = handbookHtml.trim().replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
      }
    } catch (e) {
      console.error('AI handbook generation failed:', e.message);
    }

    const handbookContent = {
      form_type: 'Employee Handbook Acknowledgment',
      employee_name: fullName,
      generated_at: new Date().toISOString(),
      company: cl.company_name,
      acknowledgment_text: `I, ${fullName}, acknowledge that I have received, read, and understand the employee handbook and policies of ${cl.company_name}. I agree to comply with all policies, procedures, and guidelines contained therein. I understand that this handbook is not a contract of employment and that my employment is at-will, meaning either party may terminate the employment relationship at any time, with or without cause or notice.`
    };

    const handbook = await upsertDocument(
      checklist_id, req.user.id, offerCompanyId,
      'Employee Handbook Acknowledgment', handbookContent,
      `Handbook acknowledgment for ${fullName}`,
      handbookHtml
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
        current_step = 6,
        steps_completed = CASE WHEN steps_completed @> '"5"'::jsonb THEN steps_completed ELSE steps_completed || '"5"'::jsonb END,
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

    // Generate printable HTML document (uses AI-generated HTML if available)
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
        <p><strong>✅ Electronically Signed</strong></p>
        <p>Signed by: ${escapeHtmlServer(doc.candidate_name)}</p>
        <p>Date: ${new Date(doc.signed_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'medium' })}</p>
        <p>IP Address: ${escapeHtmlServer(doc.signer_ip || 'N/A')}</p>
        <p>User Agent: ${escapeHtmlServer((doc.signer_user_agent || 'N/A').substring(0, 80))}</p>
       </div>`
    : '<p class="pending">⏳ Awaiting Signature</p>';

  // If we have AI-generated HTML, use it
  if (doc.ai_generated_html) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtmlServer(doc.document_type)} — ${escapeHtmlServer(doc.candidate_name)}</title>
  <style>
    @media print { body { margin: 0.5in; } .no-print { display: none; } }
    body { font-family: 'Times New Roman', serif; max-width: 850px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.6; }
    .signature-block { margin-top: 32px; padding: 16px; border: 2px solid #1e3a5f; border-radius: 4px; background: #f0f4f8; }
    .signature-block p { margin: 4px 0; font-size: 13px; }
    .pending { color: #b45309; font-style: italic; margin-top: 24px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 2px solid #1e3a5f; font-size: 12px; color: #666; }
    .no-print { margin-bottom: 24px; text-align: center; }
    .no-print button { padding: 10px 24px; background: #1e3a5f; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 0 8px; }
    .no-print button:hover { background: #152d4a; }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨️ Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  ${doc.ai_generated_html}
  ${signedInfo}
  <div class="footer">
    <p>Generated: ${content.generated_at ? new Date(content.generated_at).toLocaleString('en-US') : new Date().toLocaleString('en-US')}</p>
    <p>Document ID: ${doc.id} | Candidate: ${escapeHtmlServer(doc.candidate_name)} (${escapeHtmlServer(doc.candidate_email)})</p>
    <p style="margin-top: 8px; font-style: italic;">This document was generated by Rekrut AI AI and contains the employee's submitted information.</p>
  </div>
</body>
</html>`;
  }

  let bodyContent = '';

  if (content.form_type === 'I-9') {
    bodyContent = `
      <div class="form-header">
        <h2>Employment Eligibility Verification</h2>
        <p class="subtitle">Department of Homeland Security — U.S. Citizenship and Immigration Services</p>
        <p class="form-id">Form I-9 (Rev. 08/01/23)</p>
      </div>
      <div class="section">
        <h3>Section 1. Employee Information and Attestation</h3>
        <p style="font-size:12px;color:#555;margin-bottom:12px;">Employees must complete and sign Section 1 of Form I-9 no later than the first day of employment.</p>
        <table>
          <tr><td class="label">Last Name:</td><td>${escapeHtmlServer(content.last_name || '')}</td><td class="label">First Name:</td><td>${escapeHtmlServer(content.first_name || '')}</td></tr>
          <tr><td class="label">Middle Initial:</td><td>${escapeHtmlServer((content.middle_name || '').charAt(0) || 'N/A')}</td><td class="label">Other Last Names Used:</td><td>N/A</td></tr>
          <tr><td class="label">Date of Birth:</td><td>${content.date_of_birth ? new Date(content.date_of_birth).toLocaleDateString('en-US') : 'N/A'}</td><td class="label">SSN:</td><td>${content.ssn_last_four || '****'}</td></tr>
          <tr><td class="label">Address:</td><td colspan="3">${escapeHtmlServer(content.address || '')}</td></tr>
          <tr><td class="label">City:</td><td>${escapeHtmlServer(content.city || '')}</td><td class="label">State:</td><td>${escapeHtmlServer(content.state || '')} ${escapeHtmlServer(content.zip || '')}</td></tr>
        </table>
      </div>
      <div class="section" style="background:#f5f7fa;padding:12px;border-radius:6px;">
        <h3 style="margin-top:0;">Attestation</h3>
        <p>I attest, under penalty of perjury, that I am (check one):</p>
        <div style="margin:8px 0 8px 12px;">
          <p>${content.citizenship_status === 'citizen' ? '☑' : '☐'} A citizen of the United States</p>
          <p>${content.citizenship_status === 'noncitizen_national' ? '☑' : '☐'} A noncitizen national of the United States</p>
          <p>${content.citizenship_status === 'permanent_resident' ? '☑' : '☐'} A lawful permanent resident (Alien Reg. Number: ${escapeHtmlServer(content.alien_number || '_____')})</p>
          <p>${content.citizenship_status === 'work_authorized' ? '☑' : '☐'} An alien authorized to work until ${content.work_auth_expiry ? new Date(content.work_auth_expiry).toLocaleDateString('en-US') : '_____'}</p>
          ${content.admission_number ? `<p style="margin-left:20px;font-size:13px;">I-94 Admission Number: ${escapeHtmlServer(content.admission_number)}</p>` : ''}
          ${content.passport_number ? `<p style="margin-left:20px;font-size:13px;">Foreign Passport Number: ${escapeHtmlServer(content.passport_number)} (${escapeHtmlServer(content.country_of_issuance || '')})</p>` : ''}
        </div>
        <p style="font-size:12px;font-style:italic;">I am aware that federal law provides for imprisonment and/or fines for false statements, or the use of false documents, in connection with the completion of this form.</p>
      </div>
      <div class="section">
        <p><strong>Employer:</strong> ${escapeHtmlServer(content.company || '')}</p>
      </div>
      <p style="font-size:11px;color:#666;margin-top:16px;font-style:italic;">Anti-Discrimination Notice: It is illegal to discriminate against work-authorized individuals in hiring, firing, recruitment, or referral for a fee because of their citizenship status or national origin.</p>
    `;
  } else if (content.form_type === 'W-4') {
    const depUnder17 = content.num_dependents_under_17 || 0;
    const depOther = content.num_other_dependents || 0;
    const totalCredits = content.dependent_credits || 0;
    bodyContent = `
      <div class="form-header">
        <h2>Employee's Withholding Certificate</h2>
        <p class="subtitle">Department of the Treasury — Internal Revenue Service</p>
        <p class="form-id">Form W-4 (2024)</p>
      </div>
      <div class="section">
        <h3>Step 1: Personal Information</h3>
        <table>
          <tr><td class="label">Full Name:</td><td>${escapeHtmlServer(content.employee_name || '')}</td></tr>
          <tr><td class="label">SSN:</td><td>${content.ssn_last_four || '****'}</td></tr>
          <tr><td class="label">Address:</td><td>${escapeHtmlServer(content.address || '')}</td></tr>
          <tr><td class="label">City, State, ZIP:</td><td>${escapeHtmlServer(content.city_state_zip || '')}</td></tr>
          <tr><td class="label">Filing Status:</td><td><strong>${escapeHtmlServer(content.filing_status_label || content.filing_status || 'Single')}</strong></td></tr>
        </table>
      </div>
      <div class="section">
        <h3>Step 2: Multiple Jobs or Spouse Works</h3>
        <p>${content.multiple_jobs ? '☑ Checked — Two jobs total / spouse also works' : '☐ Not applicable — Only one job, or spouse does not work'}</p>
      </div>
      <div class="section">
        <h3>Step 3: Claim Dependents</h3>
        <table>
          <tr><td class="label">Children under 17:</td><td>${depUnder17} × $2,000 = <strong>$${(depUnder17 * 2000).toLocaleString()}</strong></td></tr>
          <tr><td class="label">Other dependents:</td><td>${depOther} × $500 = <strong>$${(depOther * 500).toLocaleString()}</strong></td></tr>
          <tr><td class="label"><strong>Total Credits:</strong></td><td><strong>$${totalCredits.toLocaleString()}</strong></td></tr>
        </table>
      </div>
      <div class="section">
        <h3>Step 4: Other Adjustments</h3>
        <table>
          <tr><td class="label">(a) Other income:</td><td>$${(content.other_income || 0).toLocaleString()}</td></tr>
          <tr><td class="label">(b) Deductions:</td><td>$${(content.deductions || 0).toLocaleString()}</td></tr>
          <tr><td class="label">(c) Extra withholding:</td><td>$${(content.extra_withholding || 0).toLocaleString()} per pay period</td></tr>
        </table>
        ${content.exempt ? '<p style="color:#b91c1c;font-weight:bold;margin-top:8px;">⚠ EXEMPT from withholding claimed</p>' : ''}
      </div>
      <div class="section" style="border-top:2px solid #ccc;padding-top:12px;margin-top:16px;">
        <h3>Employer Information</h3>
        <table>
          <tr><td class="label">Employer:</td><td>${escapeHtmlServer(content.employer || content.company || '')}</td></tr>
          <tr><td class="label">EIN:</td><td>${escapeHtmlServer(content.employer_ein || 'On file')}</td></tr>
          <tr><td class="label">First Date of Employment:</td><td>${escapeHtmlServer(content.first_date_of_employment || 'TBD')}</td></tr>
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

// Helper: upsert a document (with optional AI-generated HTML)
async function upsertDocument(checklistId, candidateId, companyId, docType, content, summary, aiHtml) {
  const existing = await pool.query(
    'SELECT * FROM onboarding_documents WHERE checklist_id = $1 AND candidate_id = $2 AND document_type = $3',
    [checklistId, candidateId, docType]
  );

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE onboarding_documents SET
        document_content = $1, content_summary = $2, status = 'pending', uploaded_at = NOW(),
        ai_generated_html = COALESCE($3, ai_generated_html),
        ai_generated_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE ai_generated_at END
       WHERE id = $4 RETURNING *`,
      [JSON.stringify(content), summary, aiHtml || null, existing.rows[0].id]
    );
    return updated.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO onboarding_documents
     (checklist_id, candidate_id, company_id, document_type, document_content, content_summary, status, uploaded_at, ai_generated_html, ai_generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7, CASE WHEN $7 IS NOT NULL THEN NOW() ELSE NULL END)
     RETURNING *`,
    [checklistId, candidateId, companyId, docType, JSON.stringify(content), summary, aiHtml || null]
  );
  return result.rows[0];
}

// Helper: Generate AI-formatted document HTML
async function generateAIDocument(formType, content, companyName) {
  let prompt = '';

  if (formType === 'I-9') {
    prompt = `Generate a professional HTML version of USCIS Form I-9 (Employment Eligibility Verification) Section 1 — Employee Information and Attestation.
This is the official USCIS Form I-9, Edition ${content.form_edition || '01/20/2025'}, OMB No. ${content.omb_number || '1615-0047'}, Expires ${content.omb_expiry || '05/31/2027'}.

PRE-FILLED EMPLOYEE DATA:
- Last Name (Family Name): ${content.last_name}
- First Name (Given Name): ${content.first_name}
- Middle Initial: ${content.middle_initial || 'N/A'}
- Other Last Names Used (e.g., maiden name): ${content.other_last_names || 'N/A'}
- Address (Street Number and Name): ${content.address}
- Apt. Number: ${content.apt_number || 'N/A'}
- City or Town: ${content.city}
- State: ${content.state}
- ZIP Code: ${content.zip}
- Date of Birth (mm/dd/yyyy): ${content.date_of_birth ? new Date(content.date_of_birth).toLocaleDateString('en-US') : 'N/A'}
- U.S. Social Security Number: ${content.ssn_last_four}
- Employee's Email Address: ${content.email || 'N/A'}
- Employee's Telephone Number: ${content.phone || 'N/A'}

CITIZENSHIP/IMMIGRATION STATUS ATTESTATION (checked box):
"${content.citizenship_label}"
${content.alien_number ? `- Alien Registration Number/USCIS Number: ${content.alien_number}` : ''}
${content.admission_number ? `- Form I-94 Admission Number: ${content.admission_number}` : ''}
${content.passport_number ? `- Foreign Passport Number: ${content.passport_number}` : ''}
${content.country_of_issuance ? `- Country of Issuance: ${content.country_of_issuance}` : ''}
${content.work_auth_expiry ? `- Expiration Date (if applicable, mm/dd/yyyy): ${new Date(content.work_auth_expiry).toLocaleDateString('en-US')}` : ''}

Employer: ${content.company}
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

EXACT LAYOUT REQUIREMENTS (match official USCIS form):
1. Top header: "Employment Eligibility Verification" (large), beneath it: "Department of Homeland Security", "U.S. Citizenship and Immigration Services", "USCIS Form I-9", "OMB No. ${content.omb_number || '1615-0047'}", "Expires ${content.omb_expiry || '05/31/2027'}"
2. "Section 1. Employee Information and Attestation" as section header
3. Row of fields: Last Name | First Name | Middle Initial | Other Last Names Used
4. Row: Address | Apt. Number | City or Town | State | ZIP Code
5. Row: Date of Birth | U.S. Social Security Number | Employee's Email | Employee's Telephone Number
6. Attestation preamble: "I attest, under penalty of perjury, that I am (check one of the following boxes):"
7. Four checkbox options (show which is selected with a checkmark):
   - "1. A citizen of the United States"
   - "2. A noncitizen national of the United States"
   - "3. A lawful permanent resident (Alien Registration Number/USCIS Number: ___)"
   - "4. An alien authorized to work until (expiration date, if applicable): ___"
   - Below option 4: "Aliens authorized to work must provide only ONE of the following document numbers: Alien Registration Number/USCIS Number OR Form I-94 Admission Number OR Foreign Passport Number and Country of Issuance"
8. Employee signature line with date
9. Anti-Discrimination Notice box: "${content.anti_discrimination_notice}"
10. False statements warning: "${content.false_statements_warning}"
11. Use professional formatting: max-width 800px, centered, serif font, light border
12. Use navy (#1e3a5f) for headers, #333 for body text, gray (#f5f5f5) backgrounds for field boxes`;
  } else if (formType === 'W-4') {
    prompt = `Generate a professional HTML version of IRS Form W-4 (Employee's Withholding Certificate) ${content.form_year || '2025'}, OMB No. ${content.omb_number || '1545-0074'}.

PRE-FILLED EMPLOYEE DATA:
- First name and middle initial: ${content.first_name} ${content.middle_initial || ''}
- Last name: ${content.last_name}
- Social Security number: ${content.ssn_last_four}
- Address: ${content.address}
- City or town, state, and ZIP code: ${content.city_state_zip}

STEP 1 - Filing Status (show selected with checkmark):
- ${content.filing_status === 'single' ? '[X]' : '[ ]'} Single or Married filing separately
- ${content.filing_status === 'married' ? '[X]' : '[ ]'} Married filing jointly or Qualifying surviving spouse
- ${content.filing_status === 'head_of_household' ? '[X]' : '[ ]'} Head of household (Check only if you're unmarried and pay more than half the costs of keeping up a home for yourself and a qualifying individual.)

STEP 2 - Multiple Jobs or Spouse Works:
Complete this step if you (1) hold more than one job at a time, or (2) are married filing jointly and your spouse also works.
- Step 2(c) checkbox: ${content.multiple_jobs_checkbox ? 'CHECKED — Two jobs total (or spouse works)' : 'Not checked'}
- Note: Other options include (a) using IRS Tax Withholding Estimator at www.irs.gov/W4App, or (b) the Multiple Jobs Worksheet.

STEP 3 - Claim Dependents:
(If total income $200,000 or less; $400,000 if married filing jointly)
- Qualifying children under age 17: ${content.num_dependents_under_17} × $${content.child_tax_credit_amount || 2000} = $${content.num_dependents_under_17 * (content.child_tax_credit_amount || 2000)}
- Other dependents: ${content.num_other_dependents} × $${content.other_dependent_credit_amount || 500} = $${content.num_other_dependents * (content.other_dependent_credit_amount || 500)}
- Total amount of credit for dependents (Step 3 line total): $${content.dependent_credits}

STEP 4 - Other Adjustments (Optional):
- 4(a) Other income (not from jobs): $${content.other_income}
- 4(b) Deductions (if claiming deductions other than standard deduction): $${content.deductions}
- 4(c) Extra withholding per pay period: $${content.extra_withholding}
${content.exempt ? '- EXEMPT: Employee claims exemption from withholding' : ''}

STEP 5 - Sign Here:
Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete.
Employee signature line with date.

EMPLOYERS ONLY (bottom section):
- Employer's name and address: ${content.employer}
- First date of employment: ${content.first_date_of_employment}
- Employer identification number (EIN): ${content.employer_ein}

EXACT LAYOUT REQUIREMENTS:
1. Top header: "Form W-4" (large, left), "Employee's Withholding Certificate" (center), "Department of the Treasury / Internal Revenue Service" (right), "OMB No. ${content.omb_number || '1545-0074'}", year "${content.form_year || '2025'}"
2. Instruction note: "Complete Form W-4 so that your employer can withhold the correct federal income tax from your pay."
3. Step 1(a) and 1(b): Personal info fields in a row, then filing status checkboxes
4. Step 2: Section with checkbox option, note about IRS estimator
5. Step 3: Dependents section with multiplication and totals
6. Step 4: Three sub-fields (4a, 4b, 4c) with dollar amounts
7. Step 5: Signature line, date, employer section below
8. Professional formatting: max-width 800px, centered, serif font, light border
9. Use navy (#1e3a5f) for headers, light gray (#f5f5f5) boxes for data fields, clear step separators`;
  }

  const html = await polsiaAI.chat(prompt, {
    system: 'You are an expert at generating government-compliant form documents in HTML. Generate clean, professional HTML with inline styles that closely matches the official form layout. Return ONLY HTML, no markdown, no code blocks, no explanations.',
    module: 'onboarding', feature: 'gov_forms'
  });

  let cleanHtml = html.trim();
  if (cleanHtml.startsWith('```')) {
    cleanHtml = cleanHtml.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleanHtml;
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
// AI-POWERED ONBOARDING FEATURES
// ============================================

// AI Pre-fill: Pull candidate data from profile/application
router.get('/wizard/ai-prefill', authMiddleware, async (req, res) => {
  try {
    // Get candidate profile data
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (user.rows.length === 0) return res.json({ prefill: {} });

    const u = user.rows[0];

    // Get candidate profile if exists
    const profile = await pool.query(
      'SELECT * FROM candidate_profiles WHERE user_id = $1',
      [req.user.id]
    );

    // Get most recent application data
    const application = await pool.query(
      `SELECT a.*, j.title as job_title, j.company
       FROM job_applications a
       LEFT JOIN jobs j ON a.job_id = j.id
       WHERE a.candidate_id = $1
       ORDER BY a.applied_at DESC LIMIT 1`,
      [req.user.id]
    );

    // Get accepted offer
    const offer = await pool.query(
      `SELECT o.*, j.title as job_title
       FROM offers o
       LEFT JOIN jobs j ON o.job_id = j.id
       WHERE o.candidate_id = $1 AND o.status = 'accepted'
       ORDER BY o.created_at DESC LIMIT 1`,
      [req.user.id]
    );

    const p = profile.rows[0] || {};
    const app = application.rows[0] || {};
    const off = offer.rows[0] || {};

    // Build pre-fill data from available sources
    const nameParts = (u.name || '').split(' ');
    const prefill = {
      legal_first_name: nameParts[0] || '',
      legal_middle_name: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '',
      legal_last_name: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
      phone: p.phone || '',
      address_line1: p.address || '',
      city: p.city || '',
      state: p.state || '',
      zip_code: p.zip_code || '',
      job_title: off.job_title || off.title || app.job_title || '',
      company_name: off.company_name || app.company || '',
      start_date: off.start_date || '',
      salary: off.salary || '',
    };

    // Use AI to suggest filing status based on salary
    let ai_suggestions = null;
    try {
      const salary = parseFloat(off.salary || 0);
      if (salary > 0) {
        const aiResponse = await polsiaAI.chat(
          `Based on a new employee starting at $${salary.toLocaleString()} annual salary, provide brief W-4 guidance. Return JSON only: { "suggested_filing_status": "single|married|head_of_household", "filing_tip": "1 sentence tip", "withholding_note": "1 sentence about expected withholding" }`,
          { system: 'You are a tax advisor assistant. Return ONLY valid JSON, no markdown, no code blocks.', module: 'onboarding', feature: 'w4_guidance' }
        );
        let cleaned = aiResponse.trim();
        if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        ai_suggestions = JSON.parse(cleaned);
      }
    } catch (e) {
      console.error('AI prefill suggestions failed (non-blocking):', e.message);
    }

    res.json({ prefill, ai_suggestions });
  } catch (err) {
    console.error('Error getting AI prefill:', err);
    res.status(500).json({ error: 'Failed to get prefill data' });
  }
});

// AI W-4 Guidance: Explain withholding options in plain language
router.post('/wizard/w4-guidance', authMiddleware, async (req, res) => {
  try {
    const { filing_status, salary, multiple_jobs, num_dependents, question } = req.body;

    const prompt = `You are a friendly HR assistant helping a new employee fill out their IRS Form W-4 (Employee's Withholding Certificate).

EMPLOYEE SITUATION:
- Annual salary: ${salary ? '$' + Number(salary).toLocaleString() : 'Not provided'}
- Filing status: ${filing_status || 'Not selected yet'}
- Multiple jobs: ${multiple_jobs ? 'Yes' : 'No'}
- Number of dependents: ${num_dependents || 0}
${question ? `- Specific question: ${question}` : ''}

Provide guidance in plain, simple English. No tax jargon. Explain each W-4 step:

Return JSON: {
  "step1_guidance": "Brief explanation of filing status options and which might apply",
  "step2_guidance": "Should they check the multiple jobs box? When does this matter?",
  "step3_guidance": "How to calculate dependent credits ($2,000 per child under 17, $500 for others)",
  "step4_guidance": "When to add other income, claim deductions, or request extra withholding",
  "personalized_tip": "1-2 sentences of personalized advice based on their specific situation",
  "estimated_credits": "Estimated total credits based on their dependents",
  "withholding_impact": "Brief note on how their choices affect their paycheck"
}`;

    const aiResponse = await polsiaAI.chat(prompt, {
      system: 'You are a helpful HR/tax assistant. Explain W-4 concepts in simple language anyone can understand. Always return valid JSON only, no markdown or code blocks.',
      module: 'onboarding', feature: 'w4_guidance'
    });

    let cleaned = aiResponse.trim();
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const guidance = JSON.parse(cleaned);

    res.json({ guidance });
  } catch (err) {
    console.error('Error getting W-4 guidance:', err);
    // Return fallback guidance instead of error
    res.json({
      guidance: {
        step1_guidance: 'Choose "Single" if unmarried, "Married Filing Jointly" if married and filing together, or "Head of Household" if you pay more than half the cost of keeping up a home for a qualifying person.',
        step2_guidance: 'Check this box only if you have more than one job at the same time, or if you\'re married filing jointly and your spouse also works.',
        step3_guidance: 'Enter $2,000 for each child under 17, and $500 for other dependents. Multiply and add.',
        step4_guidance: 'Most people can skip Step 4. Use it if you have investment income, want to claim extra deductions, or want extra tax withheld.',
        personalized_tip: 'If this is your only job and you have a simple tax situation, the default settings are usually fine.',
        estimated_credits: '0',
        withholding_impact: 'More credits and deductions = larger paycheck but potentially smaller refund.'
      }
    });
  }
});

// AI-generated Employee Handbook
router.post('/wizard/generate-handbook', authMiddleware, async (req, res) => {
  try {
    const { checklist_id } = req.body;

    // Get company info
    const checklist = await pool.query(
      `SELECT oc.*, o.company_name, o.title as offer_title
       FROM onboarding_checklists oc
       JOIN offers o ON oc.offer_id = o.id
       WHERE oc.id = $1 AND oc.candidate_id = $2`,
      [checklist_id, req.user.id]
    );

    if (checklist.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist not found' });
    }

    const cl = checklist.rows[0];
    const companyName = cl.company_name || 'The Company';

    // Get company policies if available
    let policyContext = '';
    try {
      const policies = await pool.query(
        'SELECT category, title, content FROM company_policies WHERE is_active = true ORDER BY category'
      );
      if (policies.rows.length > 0) {
        policyContext = policies.rows.map(p => `${p.category}: ${p.title} - ${p.content}`).join('\n');
      }
    } catch (e) { /* company_policies table may not exist */ }

    const prompt = `Generate a professional Employee Handbook Acknowledgment document for ${companyName}.

${policyContext ? `EXISTING COMPANY POLICIES:\n${policyContext}\n\n` : ''}

Create a comprehensive but concise handbook summary that covers:
1. At-will employment statement
2. Equal opportunity employment
3. Anti-harassment and anti-discrimination policy
4. Confidentiality and trade secrets
5. Code of conduct
6. Technology and data usage policy
7. Time off and attendance expectations
8. Safety and health
9. Grievance and reporting procedures
10. Acknowledgment statement

Return ONLY clean HTML with inline styles. Format it as a professional document. Use:
- Navy (#1e3a5f) for headers
- Professional serif font suggestions
- Clear section numbering
- The company name "${companyName}" throughout
- An acknowledgment paragraph at the bottom for the employee to sign

Make it look like a real corporate handbook acknowledgment form.`;

    const handbookHtml = await polsiaAI.chat(prompt, {
      system: 'You are an expert HR document writer. Generate professional, legally appropriate employee handbook acknowledgments. Return ONLY clean HTML with inline styles. No markdown, no code blocks, no explanations.',
      module: 'onboarding', feature: 'handbook'
    });

    let cleanHtml = handbookHtml.trim();
    if (cleanHtml.startsWith('```')) {
      cleanHtml = cleanHtml.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
    }

    res.json({ handbook_html: cleanHtml });
  } catch (err) {
    console.error('Error generating handbook:', err);
    res.status(500).json({ error: 'Failed to generate handbook' });
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
    ], { max_tokens: 1024, module: 'onboarding', feature: 'compliance_analysis' });

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
    ], { max_tokens: 512, module: 'onboarding', feature: 'hr_chatbot' });

    return response;
  } catch (err) {
    console.error('Error getting AI response:', err);
    return "I'm having trouble connecting right now. Please try again or contact HR directly.";
  }
}

module.exports = router;
