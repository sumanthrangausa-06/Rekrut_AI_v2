/**
 * Candidate Search API Routes
 * Issue #3 — Recruiter candidate discovery with semantic + filtered search
 *
 * Endpoints:
 *   GET    /api/candidates/search              — Filtered search
 *   GET    /api/candidates/search/semantic     — Semantic search (pgvector)
 *   POST   /api/candidates/search/save         — Save search query
 *   GET    /api/candidates/search/saved        — List saved searches
 *   DELETE /api/candidates/search/saved/:id    — Delete saved search
 *   GET    /api/candidates/:id/preview         — Public profile preview
 *   POST   /api/candidates/:id/invite          — Invite candidate to job
 */

const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { DistributedRateLimiter } = require('../lib/distributed-rate-limiter');
const AuditLogger = require('../services/auditLogger');
const matchingEngine = require('../services/matching-engine');

// ─── Auth & Authorization ────────────────────────────────────────

const RECRUITER_ROLES = new Set(['recruiter', 'hiring_manager', 'admin', 'employer']);

function requireRecruiter(req, res, next) {
	if (!req.user) {
		return res.status(401).json({ error: 'Authentication required' });
	}
	if (req.user.role === 'candidate') {
		return res.status(403).json({ error: 'Candidates cannot access search' });
	}
	if (!RECRUITER_ROLES.has(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}
	next();
}

// ─── Rate Limiters ───────────────────────────────────────────────

const searchRateLimiter = new DistributedRateLimiter();
const inviteRateLimiter = new DistributedRateLimiter();

// ─── Helper: Check rate limit ────────────────────────────────────

async function checkSearchRateLimit(userId) {
	const result = await searchRateLimiter.checkLimit(`search:${userId}`, 60_000, 30);
	return result;
}

async function checkInviteRateLimit(userId) {
	const result = await inviteRateLimiter.checkLimit(`invite:${userId}`, 60_000, 10);
	return result;
}

// ─── Helper: Parse pagination ────────────────────────────────────

function parsePagination(req) {
	const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
	const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
	return { limit, offset };
}

// ─── Helper: Build WHERE clause for filtered search ──────────────

function buildSearchWhere(params) {
	const conditions = ["u.role = 'candidate'"];
	const queryParams = [];
	let idx = 1;

	// Skills filter (JSONB overlap — any of the provided skills)
	if (params.skills) {
		const skillList = Array.isArray(params.skills)
			? params.skills
			: params.skills.split(',').map((s) => s.trim()).filter(Boolean);
		if (skillList.length > 0) {
			conditions.push(`csi.skills ?| $${idx}`);
			queryParams.push(skillList);
			idx++;
		}
	}

	// Location filter (partial match, case-insensitive)
	if (params.location) {
		conditions.push(`csi.location ILIKE $${idx}`);
		queryParams.push(`%${params.location}%`);
		idx++;
	}

	// Experience range
	if (params.experience_min !== undefined && params.experience_min !== '') {
		const min = parseInt(params.experience_min, 10);
		if (!isNaN(min)) {
			conditions.push(`csi.experience_years >= $${idx}`);
			queryParams.push(min);
			idx++;
		}
	}
	if (params.experience_max !== undefined && params.experience_max !== '') {
		const max = parseInt(params.experience_max, 10);
		if (!isNaN(max)) {
			conditions.push(`csi.experience_years <= $${idx}`);
			queryParams.push(max);
			idx++;
		}
	}

	// OmniScore minimum
	if (params.omni_score_min !== undefined && params.omni_score_min !== '') {
		const min = parseInt(params.omni_score_min, 10);
		if (!isNaN(min)) {
			conditions.push(`csi.omni_score >= $${idx}`);
			queryParams.push(min);
			idx++;
		}
	}

	// Availability status
	if (params.availability) {
		conditions.push(`csi.availability_status = $${idx}`);
		queryParams.push(params.availability);
		idx++;
	}

	// Score tier filter
	if (params.score_tier) {
		conditions.push(`csi.score_tier = $${idx}`);
		queryParams.push(params.score_tier);
		idx++;
	}

	// Full-text search on bio, skills, job_title
	if (params.q) {
		conditions.push(`csi.search_vector @@ plainto_tsquery('english', $${idx})`);
		queryParams.push(params.q);
		idx++;
	}

	return { whereClause: conditions.join(' AND '), queryParams, nextIndex: idx };
}

// ─── 1. GET /api/candidates/search — Filtered search ─────────────

router.get('/search', authMiddleware, requireRecruiter, async (req, res) => {
	const startTime = Date.now();

	// Rate limit
	try {
		const rl = await checkSearchRateLimit(`${req.user.id}`);
		if (!rl.allowed) {
			return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
		}
	} catch (_rlErr) {
		// fail open on rate limiter error
	}

	const { limit, offset } = parsePagination(req);
	const { whereClause, queryParams, nextIndex } = buildSearchWhere(req.query);

	const client = await pool.connect();
	try {
		// Count query
		const countResult = await client.query(
			`
        SELECT COUNT(*)::int as total
        FROM candidate_search_index csi
        INNER JOIN users u ON u.id = csi.user_id
        WHERE ${whereClause}
      `,
			queryParams,
		);
		const total = countResult.rows[0]?.total || 0;

		// Data query
		const dataResult = await client.query(
			`
        SELECT
          csi.user_id as id,
          csi.name,
          csi.avatar_url,
          csi.job_title as headline,
          csi.location,
          csi.experience_years,
          csi.omni_score,
          csi.score_tier,
          csi.availability_status,
          csi.bio,
          csi.skills,
          u.email,
          u.created_at as member_since
        FROM candidate_search_index csi
        INNER JOIN users u ON u.id = csi.user_id
        WHERE ${whereClause}
        ORDER BY csi.omni_score DESC, csi.experience_years DESC
        LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
      `,
			[...queryParams, limit, offset],
		);

		const queryTime = Date.now() - startTime;

		res.json({
			candidates: dataResult.rows,
			pagination: { limit, offset, total, hasMore: offset + dataResult.rows.length < total },
			meta: { queryTimeMs: queryTime },
		});
	} catch (err) {
		console.error('[candidateSearch] Filtered search error:', err);
		res.status(500).json({ error: 'Search failed', message: err.message });
	} finally {
		client.release();
	}
});

// ─── 2. GET /api/candidates/search/semantic — Semantic search ────

router.get('/search/semantic', authMiddleware, requireRecruiter, async (req, res) => {
	const startTime = Date.now();

	// Rate limit
	try {
		const rl = await checkSearchRateLimit(`${req.user.id}`);
		if (!rl.allowed) {
			return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
		}
	} catch (_rlErr) {
		// fail open on rate limiter error
	}

	const queryText = req.query.query || req.query.q;
	if (!queryText || queryText.trim().length === 0) {
		return res.status(400).json({ error: 'Query parameter is required' });
	}

	const { limit, offset } = parsePagination(req);
	const { whereClause, queryParams, nextIndex } = buildSearchWhere(req.query);

	let embedding;
	try {
		embedding = await matchingEngine.generateEmbedding(queryText.trim());
	} catch (embedErr) {
		console.error('[candidateSearch] Embedding generation failed:', embedErr.message);
		return res.status(503).json({ error: 'Search service temporarily unavailable. Please try again.' });
	}

	// Format embedding for pgvector
	let vectorStr;
	try {
		const pgvectorPg = require('pgvector/pg');
		vectorStr = pgvectorPg.toSql(embedding);
	} catch (_e) {
		vectorStr = `[${embedding.join(',')}]`;
	}

	const client = await pool.connect();
	try {
		// Count query with similarity threshold
		const countResult = await client.query(
			`
        SELECT COUNT(*)::int as total
        FROM candidate_search_index csi
        INNER JOIN users u ON u.id = csi.user_id
        WHERE ${whereClause}
          AND csi.embedding IS NOT NULL
          AND 1 - (csi.embedding <=> $${nextIndex}::vector) >= 0.5
      `,
			[...queryParams, vectorStr],
		);
		const total = countResult.rows[0]?.total || 0;

		// Data query — ranked by cosine similarity
		const dataResult = await client.query(
			`
        SELECT
          csi.user_id as id,
          csi.name,
          csi.avatar_url,
          csi.job_title as headline,
          csi.location,
          csi.experience_years,
          csi.omni_score,
          csi.score_tier,
          csi.availability_status,
          csi.bio,
          csi.skills,
          u.email,
          u.created_at as member_since,
          ROUND((1 - (csi.embedding <=> $${nextIndex}::vector))::numeric, 4) as similarity
        FROM candidate_search_index csi
        INNER JOIN users u ON u.id = csi.user_id
        WHERE ${whereClause}
          AND csi.embedding IS NOT NULL
          AND 1 - (csi.embedding <=> $${nextIndex}::vector) >= 0.5
        ORDER BY csi.embedding <=> $${nextIndex}::vector
        LIMIT $${nextIndex + 1} OFFSET $${nextIndex + 2}
      `,
			[...queryParams, vectorStr, limit, offset],
		);

		const queryTime = Date.now() - startTime;

		res.json({
			candidates: dataResult.rows,
			pagination: { limit, offset, total, hasMore: offset + dataResult.rows.length < total },
			meta: { queryTimeMs: queryTime, query: queryText },
		});
	} catch (err) {
		console.error('[candidateSearch] Semantic search error:', err);
		res.status(500).json({ error: 'Semantic search failed', message: err.message });
	} finally {
		client.release();
	}
});

// ─── 3. POST /api/candidates/search/save — Save search query ─────

router.post('/search/save', authMiddleware, requireRecruiter, async (req, res) => {
	const { name, filters, search_query, alert_enabled } = req.body;

	if (!name || name.trim().length === 0) {
		return res.status(400).json({ error: 'Search name is required' });
	}

	const client = await pool.connect();
	try {
		// Get company_id for the recruiter
		const companyResult = await client.query(
			'SELECT company_id FROM users WHERE id = $1',
			[req.user.id],
		);
		const companyId = companyResult.rows[0]?.company_id || null;

		const result = await client.query(
			`
        INSERT INTO saved_searches (recruiter_id, company_id, name, filters, search_query, alert_enabled, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING *
      `,
			[
				req.user.id,
				companyId,
				name.trim(),
				JSON.stringify(filters || {}),
				search_query || null,
				alert_enabled === true,
			],
		);

		await AuditLogger.log({
			actionType: 'saved_search_created',
			userId: req.user.id,
			targetType: 'saved_search',
			targetId: result.rows[0].id,
			metadata: { name: name.trim(), filters },
			req,
		});

		res.status(201).json({ saved_search: result.rows[0] });
	} catch (err) {
		console.error('[candidateSearch] Save search error:', err);
		res.status(500).json({ error: 'Failed to save search', message: err.message });
	} finally {
		client.release();
	}
});

// ─── 4. GET /api/candidates/search/saved — List saved searches ───

router.get('/search/saved', authMiddleware, requireRecruiter, async (req, res) => {
	const { limit, offset } = parsePagination(req);

	const client = await pool.connect();
	try {
		const countResult = await client.query(
			`SELECT COUNT(*)::int as total FROM saved_searches WHERE recruiter_id = $1`,
			[req.user.id],
		);
		const total = countResult.rows[0]?.total || 0;

		const dataResult = await client.query(
			`
        SELECT * FROM saved_searches
        WHERE recruiter_id = $1
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
      `,
			[req.user.id, limit, offset],
		);

		res.json({
			saved_searches: dataResult.rows,
			pagination: { limit, offset, total, hasMore: offset + dataResult.rows.length < total },
		});
	} catch (err) {
		console.error('[candidateSearch] List saved searches error:', err);
		res.status(500).json({ error: 'Failed to list saved searches' });
	} finally {
		client.release();
	}
});

// ─── 5. DELETE /api/candidates/search/saved/:id — Delete saved search

router.delete('/search/saved/:id', authMiddleware, requireRecruiter, async (req, res) => {
	const searchId = parseInt(req.params.id, 10);
	if (isNaN(searchId)) {
		return res.status(400).json({ error: 'Invalid search ID' });
	}

	const client = await pool.connect();
	try {
		// Verify ownership
		const checkResult = await client.query(
			`SELECT recruiter_id FROM saved_searches WHERE id = $1`,
			[searchId],
		);
		if (checkResult.rows.length === 0) {
			return res.status(404).json({ error: 'Saved search not found' });
		}
		if (checkResult.rows[0].recruiter_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'Not authorized to delete this saved search' });
		}

		await client.query(`DELETE FROM saved_searches WHERE id = $1`, [searchId]);

		await AuditLogger.log({
			actionType: 'saved_search_deleted',
			userId: req.user.id,
			targetType: 'saved_search',
			targetId: searchId,
			req,
		});

		res.json({ success: true, message: 'Saved search deleted' });
	} catch (err) {
		console.error('[candidateSearch] Delete saved search error:', err);
		res.status(500).json({ error: 'Failed to delete saved search' });
	} finally {
		client.release();
	}
});

// ─── 6. GET /api/candidates/:id/preview — Public profile preview ─

router.get('/:id/preview', authMiddleware, requireRecruiter, async (req, res) => {
	const candidateId = parseInt(req.params.id, 10);
	if (isNaN(candidateId)) {
		return res.status(400).json({ error: 'Invalid candidate ID' });
	}

	const client = await pool.connect();
	try {
		// Verify the user is actually a candidate
		const userCheck = await client.query(
			`SELECT role FROM users WHERE id = $1`,
			[candidateId],
		);
		if (userCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate not found' });
		}
		if (userCheck.rows[0].role !== 'candidate') {
			return res.status(404).json({ error: 'Not a candidate profile' });
		}

		const profileResult = await client.query(
			`
        SELECT
          u.id,
          u.name,
          u.avatar_url,
          u.created_at as member_since,
          cp.headline,
          cp.bio,
          cp.location,
          cp.years_experience,
          cp.availability,
          cp.remote_preference,
          cp.preferred_job_types,
          cp.preferred_locations,
          os.total_score as omni_score,
          os.score_tier
        FROM users u
        LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
        LEFT JOIN omni_scores os ON os.user_id = u.id
        WHERE u.id = $1 AND u.role = 'candidate'
      `,
			[candidateId],
		);

		if (profileResult.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate not found' });
		}

		const profile = profileResult.rows[0];

		// Fetch skills
		const skillsResult = await client.query(
			`SELECT skill_name, level, is_verified FROM candidate_skills WHERE user_id = $1 ORDER BY level DESC`,
			[candidateId],
		);

		// Fetch top 3 work experiences
		const experienceResult = await client.query(
			`
        SELECT company_name, title, location, start_date, end_date, is_current, description
        FROM work_experience
        WHERE user_id = $1
        ORDER BY is_current DESC, end_date DESC NULLS FIRST, start_date DESC
        LIMIT 3
      `,
			[candidateId],
		);

		// Fetch top 2 education entries
		const educationResult = await client.query(
			`
        SELECT institution, degree, field_of_study
        FROM education
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 2
      `,
			[candidateId],
		);

		// Check if already invited by this recruiter
		const inviteResult = await client.query(
			`
        SELECT status FROM candidate_invites
        WHERE candidate_id = $1 AND recruiter_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
			[candidateId, req.user.id],
		);

		res.json({
			candidate: {
				...profile,
				skills: skillsResult.rows,
				experience: experienceResult.rows,
				education: educationResult.rows,
				invite_status: inviteResult.rows[0]?.status || null,
			},
		});
	} catch (err) {
		console.error('[candidateSearch] Preview error:', err);
		res.status(500).json({ error: 'Failed to load candidate preview' });
	} finally {
		client.release();
	}
});

// ─── 7. POST /api/candidates/:id/invite — Invite candidate ───────

router.post('/:id/invite', authMiddleware, requireRecruiter, async (req, res) => {
	const candidateId = parseInt(req.params.id, 10);
	if (isNaN(candidateId)) {
		return res.status(400).json({ error: 'Invalid candidate ID' });
	}

	// Rate limit
	try {
		const rl = await checkInviteRateLimit(`${req.user.id}`);
		if (!rl.allowed) {
			return res.status(429).json({ error: 'Invite rate limit exceeded. Try again in a minute.' });
		}
	} catch (_rlErr) {
		// fail open on rate limiter error
	}

	const { job_id, message } = req.body;

	const client = await pool.connect();
	try {
		// Verify candidate exists and is a candidate
		const userCheck = await client.query(
			`SELECT role FROM users WHERE id = $1`,
			[candidateId],
		);
		if (userCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate not found' });
		}
		if (userCheck.rows[0].role !== 'candidate') {
			return res.status(400).json({ error: 'Target user is not a candidate' });
		}

		// Get recruiter's company
		const recruiterResult = await client.query(
			`SELECT company_id FROM users WHERE id = $1`,
			[req.user.id],
		);
		const companyId = recruiterResult.rows[0]?.company_id || null;

		// Validate job_id if provided
		if (job_id) {
			const jobCheck = await client.query(
				`SELECT id FROM jobs WHERE id = $1 AND company_id = $2`,
				[job_id, companyId],
			);
			if (jobCheck.rows.length === 0) {
				return res.status(400).json({ error: 'Invalid job ID or job does not belong to your company' });
			}
		}

		// Check for existing pending invite
		const existingResult = await client.query(
			`
        SELECT id, status FROM candidate_invites
        WHERE candidate_id = $1 AND recruiter_id = $2 AND job_id IS NOT DISTINCT FROM $3
      `,
			[candidateId, req.user.id, job_id || null],
		);

		if (existingResult.rows.length > 0 && existingResult.rows[0].status === 'pending') {
			return res.status(409).json({ error: 'An invitation is already pending for this candidate' });
		}

		// Upsert invite (if rejected previously, create new; if pending, blocked above)
		const result = await client.query(
			`
        INSERT INTO candidate_invites (candidate_id, recruiter_id, company_id, job_id, message, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())
        ON CONFLICT (candidate_id, recruiter_id, job_id) DO UPDATE SET
          message = EXCLUDED.message,
          status = 'pending',
          updated_at = NOW()
        RETURNING *
      `,
			[candidateId, req.user.id, companyId, job_id || null, message || null],
		);

		await AuditLogger.log({
			actionType: 'candidate_invited',
			userId: req.user.id,
			targetType: 'candidate',
			targetId: candidateId,
			metadata: { job_id: job_id || null, company_id: companyId },
			req,
		});

		res.status(201).json({
			invite: result.rows[0],
			message: 'Invitation sent successfully',
		});
	} catch (err) {
		console.error('[candidateSearch] Invite error:', err);
		res.status(500).json({ error: 'Failed to send invitation', message: err.message });
	} finally {
		client.release();
	}
});

module.exports = router;
