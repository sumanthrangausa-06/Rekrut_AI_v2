const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// ─── Authorization Helpers ──────────────────────────────────────────────────

function requireRecruiter(req, res, next) {
	const allowed = ['recruiter', 'hiring_manager', 'employer', 'admin'];
	if (!allowed.includes(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}
	next();
}

function requireCompanyOwnerOrRecruiter(req, res, next) {
	const allowed = ['recruiter', 'hiring_manager', 'employer', 'admin'];
	if (!allowed.includes(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter or company owner access required' });
	}
	next();
}

async function verifyPanelMember(req, res, next) {
	const panelId = req.params.id;
	const userId = req.user.id;

	try {
		const result = await pool.query(
			`SELECT * FROM panel_members WHERE panel_id = $1 AND user_id = $2 AND status = 'joined'`,
			[panelId, userId],
		);
		if (result.rows.length === 0) {
			return res.status(403).json({ error: 'Panel member access required' });
		}
		req.panelMember = result.rows[0];
		next();
	} catch (err) {
		console.error('Panel member verification error:', err);
		res.status(500).json({ error: 'Failed to verify panel membership' });
	}
}

async function verifyPanelAccess(req, res, next) {
	// Allow recruiter/admin or panel member
	const allowedRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
	if (allowedRoles.includes(req.user.role)) {
		return next();
	}
	return verifyPanelMember(req, res, next);
}

async function getPanelWithMembers(panelId) {
	const panelResult = await pool.query(
		`SELECT ip.*, j.title as job_title, j.company_id as job_company_id
     FROM interview_panels ip
     JOIN jobs j ON ip.job_id = j.id
     WHERE ip.id = $1`,
		[panelId],
	);
	if (panelResult.rows.length === 0) return null;

	const membersResult = await pool.query(
		`SELECT pm.*, u.name, u.email, u.avatar_url
     FROM panel_members pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.panel_id = $1
     ORDER BY pm.created_at ASC`,
		[panelId],
	);

	const panel = panelResult.rows[0];
	panel.members = membersResult.rows;
	return panel;
}

// ─── GET /api/panels/:jobId — list panels for a job ─────────────────────────
router.get('/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { jobId } = req.params;
		const { limit = 20, offset = 0 } = req.query;

		// Verify recruiter has access to this job's company
		const jobCheck = await pool.query(
			`SELECT company_id FROM jobs WHERE id = $1`,
			[jobId],
		);
		if (jobCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Admin can access any job; recruiters only their company
		if (req.user.role !== 'admin') {
			if (req.user.company_id !== jobCheck.rows[0].company_id) {
				return res.status(403).json({ error: 'Access denied for this job' });
			}
		}

		const panelsResult = await pool.query(
			`SELECT ip.*, j.title as job_title,
        COUNT(pm.id) FILTER (WHERE pm.status = 'joined') as joined_count,
        COUNT(pm.id) as total_members
       FROM interview_panels ip
       JOIN jobs j ON ip.job_id = j.id
       LEFT JOIN panel_members pm ON pm.panel_id = ip.id
       WHERE ip.job_id = $1
       GROUP BY ip.id, j.title
       ORDER BY ip.created_at DESC
       LIMIT $2 OFFSET $3`,
			[jobId, Number(limit), Number(offset)],
		);

		const totalResult = await pool.query(
			`SELECT COUNT(*) as count FROM interview_panels WHERE job_id = $1`,
			[jobId],
		);

		res.json({
			panels: panelsResult.rows,
			total: parseInt(totalResult.rows[0].count, 10),
		});
	} catch (err) {
		console.error('List panels error:', err);
		res.status(500).json({ error: 'Failed to fetch panels' });
	}
});

// ─── POST /api/panels — create a panel ──────────────────────────────────────
router.post('/', authMiddleware, requireCompanyOwnerOrRecruiter, async (req, res) => {
	try {
		const { job_id, interview_session_id, member_user_ids = [] } = req.body;

		if (!job_id) {
			return res.status(400).json({ error: 'job_id is required' });
		}

		// Verify recruiter has access to this job
		const jobCheck = await pool.query(
			`SELECT company_id FROM jobs WHERE id = $1`,
			[job_id],
		);
		if (jobCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		if (req.user.role !== 'admin' && req.user.company_id !== jobCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied for this job' });
		}

		// Create the panel
		const panelResult = await pool.query(
			`INSERT INTO interview_panels (job_id, interview_session_id, status)
       VALUES ($1, $2, 'active')
       RETURNING *`,
			[job_id, interview_session_id || null],
		);
		const panel = panelResult.rows[0];

		// Add creator as lead interviewer
		await pool.query(
			`INSERT INTO panel_members (panel_id, user_id, role, status, joined_at)
       VALUES ($1, $2, 'lead', 'joined', NOW())
       ON CONFLICT (panel_id, user_id) DO NOTHING`,
			[panel.id, req.user.id],
		);

		// Add other members as panelists
		for (const userId of member_user_ids) {
			if (userId === req.user.id) continue;
			await pool.query(
				`INSERT INTO panel_members (panel_id, user_id, role, status)
         VALUES ($1, $2, 'panelist', 'invited')
         ON CONFLICT (panel_id, user_id) DO NOTHING`,
				[panel.id, userId],
			);
		}

		const fullPanel = await getPanelWithMembers(panel.id);
		res.status(201).json({ panel: fullPanel });
	} catch (err) {
		console.error('Create panel error:', err);
		res.status(500).json({ error: 'Failed to create panel' });
	}
});

// ─── POST /api/panels/:id/members — add member to panel ─────────────────────
router.post('/:id/members', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { id } = req.params;
		const { user_id, role = 'panelist' } = req.body;

		if (!user_id) {
			return res.status(400).json({ error: 'user_id is required' });
		}

		const validRoles = ['lead', 'panelist', 'hiring_manager', 'observer'];
		if (!validRoles.includes(role)) {
			return res.status(400).json({ error: 'Invalid role' });
		}

		// Verify panel exists and recruiter has access
		const panelCheck = await pool.query(
			`SELECT ip.*, j.company_id
       FROM interview_panels ip
       JOIN jobs j ON ip.job_id = j.id
       WHERE ip.id = $1`,
			[id],
		);
		if (panelCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Panel not found' });
		}
		if (req.user.role !== 'admin' && req.user.company_id !== panelCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Verify user exists
		const userCheck = await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [user_id]);
		if (userCheck.rows.length === 0) {
			return res.status(404).json({ error: 'User not found' });
		}

		const result = await pool.query(
			`INSERT INTO panel_members (panel_id, user_id, role, status)
       VALUES ($1, $2, $3, 'invited')
       ON CONFLICT (panel_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         status = CASE WHEN panel_members.status = 'declined' THEN 'invited' ELSE panel_members.status END,
         updated_at = NOW()
       RETURNING *`,
			[id, user_id, role],
		);

		res.json({ member: { ...result.rows[0], user: userCheck.rows[0] } });
	} catch (err) {
		console.error('Add member error:', err);
		res.status(500).json({ error: 'Failed to add member' });
	}
});

// ─── DELETE /api/panels/:id/members/:userId — remove member ─────────────────
router.delete('/:id/members/:userId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { id, userId } = req.params;

		// Verify panel exists and recruiter has access
		const panelCheck = await pool.query(
			`SELECT ip.*, j.company_id
       FROM interview_panels ip
       JOIN jobs j ON ip.job_id = j.id
       WHERE ip.id = $1`,
			[id],
		);
		if (panelCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Panel not found' });
		}
		if (req.user.role !== 'admin' && req.user.company_id !== panelCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Prevent removing the last lead
		const leadCheck = await pool.query(
			`SELECT * FROM panel_members WHERE panel_id = $1 AND user_id = $2 AND role = 'lead'`,
			[id, userId],
		);
		if (leadCheck.rows.length > 0) {
			const otherLeads = await pool.query(
				`SELECT COUNT(*) as count FROM panel_members WHERE panel_id = $1 AND role = 'lead' AND user_id != $2`,
				[id, userId],
			);
			if (parseInt(otherLeads.rows[0].count, 10) === 0) {
				return res.status(400).json({ error: 'Cannot remove the only lead interviewer' });
			}
		}

		await pool.query(`DELETE FROM panel_members WHERE panel_id = $1 AND user_id = $2`, [id, userId]);

		res.json({ success: true, removed: true });
	} catch (err) {
		console.error('Remove member error:', err);
		res.status(500).json({ error: 'Failed to remove member' });
	}
});

// ─── GET /api/panels/:id/notes — list shared notes (panel members only) ─────
router.get('/:id/notes', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;

		const result = await pool.query(
			`SELECT pn.*, u.name as author_name, u.avatar_url as author_avatar
       FROM panel_notes pn
       JOIN users u ON pn.author_id = u.id
       WHERE pn.panel_id = $1 AND pn.visibility = 'shared'
       ORDER BY pn.created_at DESC`,
			[id],
		);

		res.json({ notes: result.rows });
	} catch (err) {
		console.error('List shared notes error:', err);
		res.status(500).json({ error: 'Failed to fetch notes' });
	}
});

// ─── POST /api/panels/:id/notes — create a note (panel members only) ────────
router.post('/:id/notes', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;
		const { content, visibility = 'shared' } = req.body;

		if (!content || content.trim().length === 0) {
			return res.status(400).json({ error: 'content is required' });
		}

		const validVisibilities = ['shared', 'private'];
		if (!validVisibilities.includes(visibility)) {
			return res.status(400).json({ error: 'Invalid visibility' });
		}

		const result = await pool.query(
			`INSERT INTO panel_notes (panel_id, author_id, content, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
			[id, req.user.id, content.trim(), visibility],
		);

		const note = result.rows[0];
		note.author_name = req.user.name;
		note.author_avatar = req.user.avatar_url;

		res.status(201).json({ note });
	} catch (err) {
		console.error('Create note error:', err);
		res.status(500).json({ error: 'Failed to create note' });
	}
});

// ─── GET /api/panels/:id/private-notes — list my private notes ──────────────
router.get('/:id/private-notes', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;

		const result = await pool.query(
			`SELECT pn.*, u.name as author_name, u.avatar_url as author_avatar
       FROM panel_notes pn
       JOIN users u ON pn.author_id = u.id
       WHERE pn.panel_id = $1 AND pn.author_id = $2 AND pn.visibility = 'private'
       ORDER BY pn.created_at DESC`,
			[id, req.user.id],
		);

		res.json({ notes: result.rows });
	} catch (err) {
		console.error('List private notes error:', err);
		res.status(500).json({ error: 'Failed to fetch private notes' });
	}
});

// ─── POST /api/panels/:id/scorecards — create/update my scorecard ───────────
router.post('/:id/scorecards', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;
		const { items, overall_recommendation } = req.body;

		// Get or create scorecard
		let scorecardResult = await pool.query(
			`SELECT * FROM scorecards WHERE panel_id = $1 AND interviewer_id = $2`,
			[id, req.user.id],
		);

		let scorecard;
		if (scorecardResult.rows.length === 0) {
			const insertResult = await pool.query(
				`INSERT INTO scorecards (panel_id, interviewer_id, status)
         VALUES ($1, $2, 'draft')
         RETURNING *`,
				[id, req.user.id],
			);
			scorecard = insertResult.rows[0];
		} else {
			scorecard = scorecardResult.rows[0];
			if (scorecard.status === 'submitted') {
				return res.status(400).json({ error: 'Scorecard already submitted and cannot be modified' });
			}
		}

		// Update overall recommendation if provided
		if (overall_recommendation !== undefined) {
			const validRecs = [
				'strong_hire',
				'hire',
				'lean_hire',
				'neutral',
				'lean_no_hire',
				'no_hire',
				'strong_no_hire',
			];
			if (!validRecs.includes(overall_recommendation)) {
				return res.status(400).json({ error: 'Invalid overall_recommendation' });
			}
			await pool.query(
				`UPDATE scorecards SET overall_recommendation = $1, updated_at = NOW() WHERE id = $2`,
				[overall_recommendation, scorecard.id],
			);
		}

		// Upsert scorecard items
		if (items && Array.isArray(items)) {
			for (const item of items) {
				const { criterion_name, rating, comment, weight } = item;
				if (!criterion_name) continue;

				if (rating !== undefined && (rating < 1 || rating > 5)) {
					return res.status(400).json({ error: `Rating for ${criterion_name} must be 1-5` });
				}

				await pool.query(
					`INSERT INTO scorecard_items (scorecard_id, criterion_name, rating, comment, weight)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (scorecard_id, criterion_name) DO UPDATE SET
             rating = EXCLUDED.rating,
             comment = EXCLUDED.comment,
             weight = EXCLUDED.weight,
             updated_at = NOW()`,
					[scorecard.id, criterion_name, rating || null, comment || null, weight || 1.0],
				);
			}
		}

		// Fetch updated scorecard with items
		const updatedResult = await pool.query(
			`SELECT * FROM scorecards WHERE id = $1`,
			[scorecard.id],
		);
		const itemsResult = await pool.query(
			`SELECT * FROM scorecard_items WHERE scorecard_id = $1`,
			[scorecard.id],
		);

		res.json({
			scorecard: updatedResult.rows[0],
			items: itemsResult.rows,
		});
	} catch (err) {
		console.error('Update scorecard error:', err);
		res.status(500).json({ error: 'Failed to update scorecard' });
	}
});

// ─── POST /api/panels/:id/scorecards/submit — submit my scorecard (locks it) ─
router.post('/:id/scorecards/submit', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;

		// Get the panel's job criteria to validate all required criteria are rated
		const panelResult = await pool.query(`SELECT job_id FROM interview_panels WHERE id = $1`, [id]);
		if (panelResult.rows.length === 0) {
			return res.status(404).json({ error: 'Panel not found' });
		}
		const jobId = panelResult.rows[0].job_id;

		const criteriaResult = await pool.query(
			`SELECT criterion_name, required FROM panel_scorecard_criteria WHERE job_id = $1`,
			[jobId],
		);
		const requiredCriteria = criteriaResult.rows.filter((c) => c.required).map((c) => c.criterion_name);

		let scorecardResult = await pool.query(
			`SELECT * FROM scorecards WHERE panel_id = $1 AND interviewer_id = $2`,
			[id, req.user.id],
		);

		let scorecard;
		if (scorecardResult.rows.length === 0) {
			const insertResult = await pool.query(
				`INSERT INTO scorecards (panel_id, interviewer_id, status)
         VALUES ($1, $2, 'draft')
         RETURNING *`,
				[id, req.user.id],
			);
			scorecard = insertResult.rows[0];
		} else {
			scorecard = scorecardResult.rows[0];
			if (scorecard.status === 'submitted') {
				return res.status(400).json({ error: 'Scorecard already submitted' });
			}
		}

		// Check required criteria are rated
		if (requiredCriteria.length > 0) {
			const itemsResult = await pool.query(
				`SELECT criterion_name, rating FROM scorecard_items WHERE scorecard_id = $1`,
				[scorecard.id],
			);
			const ratedCriteria = new Set(itemsResult.rows.filter((i) => i.rating !== null).map((i) => i.criterion_name));
			const missing = requiredCriteria.filter((c) => !ratedCriteria.has(c));
			if (missing.length > 0) {
				return res.status(400).json({
					error: 'Missing required criteria ratings',
					missing,
				});
			}
		}

		// Submit the scorecard
		await pool.query(
			`UPDATE scorecards SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
			[scorecard.id],
		);

		const updatedResult = await pool.query(`SELECT * FROM scorecards WHERE id = $1`, [scorecard.id]);
		res.json({ scorecard: updatedResult.rows[0], submitted: true });
	} catch (err) {
		console.error('Submit scorecard error:', err);
		res.status(500).json({ error: 'Failed to submit scorecard' });
	}
});

// ─── GET /api/panels/:id/scorecards — list scorecards (revealed only if all submitted) ─
router.get('/:id/scorecards', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;

		// Get all panel members (joined)
		const membersResult = await pool.query(
			`SELECT user_id FROM panel_members WHERE panel_id = $1 AND status = 'joined'`,
			[id],
		);
		const memberIds = membersResult.rows.map((m) => m.user_id);

		// Get all scorecards for this panel
		const scorecardsResult = await pool.query(
			`SELECT s.*, u.name as interviewer_name
       FROM scorecards s
       JOIN users u ON s.interviewer_id = u.id
       WHERE s.panel_id = $1`,
			[id],
		);

		// Check if all joined members have submitted
		const submittedIds = scorecardsResult.rows
			.filter((s) => s.status === 'submitted')
			.map((s) => s.interviewer_id);
		const allSubmitted =
			memberIds.length > 0 && memberIds.every((id) => submittedIds.includes(id));

		if (!allSubmitted) {
			// Return only submission status, hide actual scores
			return res.json({
				revealed: false,
				message: 'Scores hidden until all panel members submit',
				total_members: memberIds.length,
				submitted_count: submittedIds.length,
				scorecards: scorecardsResult.rows.map((s) => ({
					id: s.id,
					interviewer_id: s.interviewer_id,
					interviewer_name: s.interviewer_name,
					status: s.status,
					submitted_at: s.submitted_at,
				})),
			});
		}

		// All submitted — reveal full scores
		const detailedScorecards = [];
		for (const sc of scorecardsResult.rows) {
			const itemsResult = await pool.query(
				`SELECT * FROM scorecard_items WHERE scorecard_id = $1`,
				[sc.id],
			);
			detailedScorecards.push({
				...sc,
				items: itemsResult.rows,
			});
		}

		res.json({
			revealed: true,
			total_members: memberIds.length,
			submitted_count: submittedIds.length,
			scorecards: detailedScorecards,
		});
	} catch (err) {
		console.error('List scorecards error:', err);
		res.status(500).json({ error: 'Failed to fetch scorecards' });
	}
});

// ─── GET /api/panels/:id/aggregate — get aggregate recommendation ───────────
router.get('/:id/aggregate', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;

		// Get all panel members (joined)
		const membersResult = await pool.query(
			`SELECT user_id FROM panel_members WHERE panel_id = $1 AND status = 'joined'`,
			[id],
		);
		const memberIds = membersResult.rows.map((m) => m.user_id);

		// Get all submitted scorecards
		const scorecardsResult = await pool.query(
			`SELECT s.*, u.name as interviewer_name
       FROM scorecards s
       JOIN users u ON s.interviewer_id = u.id
       WHERE s.panel_id = $1 AND s.status = 'submitted'`,
			[id],
		);

		const submittedIds = scorecardsResult.rows.map((s) => s.interviewer_id);
		const allSubmitted =
			memberIds.length > 0 && memberIds.every((id) => submittedIds.includes(id));

		if (!allSubmitted) {
			return res.status(403).json({
				error: 'Aggregate not available until all scorecards are submitted',
				total_members: memberIds.length,
				submitted_count: submittedIds.length,
			});
		}

		// Compute aggregate recommendation
		const recommendationOrder = [
			'strong_hire',
			'hire',
			'lean_hire',
			'neutral',
			'lean_no_hire',
			'no_hire',
			'strong_no_hire',
		];
		const recScores = {
			strong_hire: 3,
			hire: 2,
			lean_hire: 1,
			neutral: 0,
			lean_no_hire: -1,
			no_hire: -2,
			strong_no_hire: -3,
		};

		let totalScore = 0;
		const distribution = {};
		for (const sc of scorecardsResult.rows) {
			const rec = sc.overall_recommendation || 'neutral';
			totalScore += recScores[rec] || 0;
			distribution[rec] = (distribution[rec] || 0) + 1;
		}

		const avgScore = totalScore / scorecardsResult.rows.length;
		let aggregateRecommendation;
		if (avgScore >= 2.5) aggregateRecommendation = 'strong_hire';
		else if (avgScore >= 1.5) aggregateRecommendation = 'hire';
		else if (avgScore >= 0.5) aggregateRecommendation = 'lean_hire';
		else if (avgScore > -0.5) aggregateRecommendation = 'neutral';
		else if (avgScore > -1.5) aggregateRecommendation = 'lean_no_hire';
		else if (avgScore > -2.5) aggregateRecommendation = 'no_hire';
		else aggregateRecommendation = 'strong_no_hire';

		// Compute average per-criterion rating
		const itemsResult = await pool.query(
			`SELECT si.criterion_name,
              AVG(si.rating) as avg_rating,
              COUNT(*) as rating_count
       FROM scorecards s
       JOIN scorecard_items si ON si.scorecard_id = s.id
       WHERE s.panel_id = $1 AND s.status = 'submitted' AND si.rating IS NOT NULL
       GROUP BY si.criterion_name`,
			[id],
		);

		res.json({
			aggregate_recommendation: aggregateRecommendation,
			avg_score: Math.round(avgScore * 100) / 100,
			distribution,
			criteria_averages: itemsResult.rows,
			total_members: memberIds.length,
			submitted_count: submittedIds.length,
		});
	} catch (err) {
		console.error('Get aggregate error:', err);
		res.status(500).json({ error: 'Failed to compute aggregate' });
	}
});

// ─── GET /api/panels/:id — get panel details ────────────────────────────────
router.get('/:id', authMiddleware, verifyPanelAccess, async (req, res) => {
	try {
		const { id } = req.params;
		const panel = await getPanelWithMembers(id);
		if (!panel) {
			return res.status(404).json({ error: 'Panel not found' });
		}
		res.json({ panel });
	} catch (err) {
		console.error('Get panel error:', err);
		res.status(500).json({ error: 'Failed to fetch panel' });
	}
});

// ─── POST /api/panels/:id/join — panel member accepts invitation ────────────
router.post('/:id/join', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;

		const result = await pool.query(
			`UPDATE panel_members
       SET status = 'joined', joined_at = NOW(), updated_at = NOW()
       WHERE panel_id = $1 AND user_id = $2 AND status = 'invited'
       RETURNING *`,
			[id, req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Invitation not found or already responded' });
		}

		res.json({ member: result.rows[0], joined: true });
	} catch (err) {
		console.error('Join panel error:', err);
		res.status(500).json({ error: 'Failed to join panel' });
	}
});

// ─── POST /api/panels/:id/decline — panel member declines invitation ────────
router.post('/:id/decline', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;

		const result = await pool.query(
			`UPDATE panel_members
       SET status = 'declined', updated_at = NOW()
       WHERE panel_id = $1 AND user_id = $2 AND status = 'invited'
       RETURNING *`,
			[id, req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Invitation not found or already responded' });
		}

		res.json({ member: result.rows[0], declined: true });
	} catch (err) {
		console.error('Decline panel error:', err);
		res.status(500).json({ error: 'Failed to decline invitation' });
	}
});

// ─── GET /api/panels/:id/my-scorecard — get my scorecard (draft or submitted) ─
router.get('/:id/my-scorecard', authMiddleware, verifyPanelMember, async (req, res) => {
	try {
		const { id } = req.params;

		const scorecardResult = await pool.query(
			`SELECT * FROM scorecards WHERE panel_id = $1 AND interviewer_id = $2`,
			[id, req.user.id],
		);

		if (scorecardResult.rows.length === 0) {
			return res.json({ scorecard: null, items: [] });
		}

		const scorecard = scorecardResult.rows[0];
		const itemsResult = await pool.query(
			`SELECT * FROM scorecard_items WHERE scorecard_id = $1`,
			[scorecard.id],
		);

		res.json({ scorecard, items: itemsResult.rows });
	} catch (err) {
		console.error('Get my scorecard error:', err);
		res.status(500).json({ error: 'Failed to fetch scorecard' });
	}
});

// ─── Scorecard Criteria Management (per job) ────────────────────────────────

// GET /api/panels/criteria/:jobId — list criteria for a job
router.get('/criteria/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { jobId } = req.params;

		const jobCheck = await pool.query(`SELECT company_id FROM jobs WHERE id = $1`, [jobId]);
		if (jobCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		if (req.user.role !== 'admin' && req.user.company_id !== jobCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const result = await pool.query(
			`SELECT * FROM panel_scorecard_criteria WHERE job_id = $1 ORDER BY sort_order ASC, created_at ASC`,
			[jobId],
		);

		res.json({ criteria: result.rows });
	} catch (err) {
		console.error('List criteria error:', err);
		res.status(500).json({ error: 'Failed to fetch criteria' });
	}
});

// POST /api/panels/criteria/:jobId — create/update criteria for a job
router.post('/criteria/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { jobId } = req.params;
		const { criteria } = req.body; // Array of { criterion_name, description, weight, required, sort_order }

		const jobCheck = await pool.query(`SELECT company_id FROM jobs WHERE id = $1`, [jobId]);
		if (jobCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		if (req.user.role !== 'admin' && req.user.company_id !== jobCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied' });
		}

		if (!Array.isArray(criteria)) {
			return res.status(400).json({ error: 'criteria must be an array' });
		}

		const results = [];
		for (const c of criteria) {
			if (!c.criterion_name) continue;
			const result = await pool.query(
				`INSERT INTO panel_scorecard_criteria
           (job_id, criterion_name, description, weight, required, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (job_id, criterion_name) DO UPDATE SET
           description = EXCLUDED.description,
           weight = EXCLUDED.weight,
           required = EXCLUDED.required,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
         RETURNING *`,
				[
					jobId,
					c.criterion_name,
					c.description || null,
					c.weight || 1.0,
					c.required !== false,
					c.sort_order || 0,
				],
			);
			results.push(result.rows[0]);
		}

		res.json({ criteria: results });
	} catch (err) {
		console.error('Upsert criteria error:', err);
		res.status(500).json({ error: 'Failed to save criteria' });
	}
});

// DELETE /api/panels/criteria/:jobId/:criterionId — delete a criterion
router.delete('/criteria/:jobId/:criterionId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { jobId, criterionId } = req.params;

		const jobCheck = await pool.query(`SELECT company_id FROM jobs WHERE id = $1`, [jobId]);
		if (jobCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		if (req.user.role !== 'admin' && req.user.company_id !== jobCheck.rows[0].company_id) {
			return res.status(403).json({ error: 'Access denied' });
		}

		await pool.query(
			`DELETE FROM panel_scorecard_criteria WHERE id = $1 AND job_id = $2`,
			[criterionId, jobId],
		);

		res.json({ success: true, deleted: true });
	} catch (err) {
		console.error('Delete criterion error:', err);
		res.status(500).json({ error: 'Failed to delete criterion' });
	}
});

module.exports = router;
