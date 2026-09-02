const express = require('express');
const crypto = require('node:crypto');
const { authMiddleware } = require('../lib/auth');
const pool = require('../lib/db');
const aiProvider = require('../lib/ai-provider');

// Reuse matching engine's profile builder if available
let buildCandidateProfileText;
try {
	const matchingEngine = require('../services/matching-engine');
	buildCandidateProfileText = matchingEngine.buildCandidateProfileText;
} catch (_e) {
	buildCandidateProfileText = null;
}

const router = express.Router();

// ─── In-memory cache with TTL ───────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const matchCache = new Map();

function getCacheKey(userId, page, limit) {
	return `${userId}:${page}:${limit}`;
}

function getCached(key) {
	const entry = matchCache.get(key);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		matchCache.delete(key);
		return null;
	}
	return entry.data;
}

function setCached(key, data) {
	matchCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Helpers ────────────────────────────────────────────────────────────

function sendError(res, err, consolePrefix) {
	const ref = crypto.randomUUID();
	console.error(`[ERROR ref=${ref}] ${consolePrefix}:`, err);
	res.status(500).json({ error: 'Internal server error', ref });
}

function safeParseJSON(text) {
	if (!text || typeof text !== 'string') return null;
	// Strip markdown fences
	const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
	try {
		return JSON.parse(cleaned);
	} catch (_e) {
		// Try extracting JSON array/object from text
		const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
		const objMatch = cleaned.match(/\{[\s\S]*\}/);
		const jsonStr = arrayMatch ? arrayMatch[0] : objMatch ? objMatch[0] : null;
		if (jsonStr) {
			try {
				return JSON.parse(jsonStr);
			} catch (_e2) {
				return null;
			}
		}
		return null;
	}
}

/**
 * Build candidate profile text for AI prompts.
 * Falls back to inline builder if matching-engine is unavailable.
 */
async function buildProfileText(userId) {
	const client = await pool.connect();
	try {
		const userResult = await client.query(
			`SELECT cp.*, u.name, u.email
       FROM users u
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1`,
			[userId],
		);

		if (userResult.rows.length === 0) return '';

		const profile = userResult.rows[0];

		// Fetch skills
		const skillsResult = await client.query(
			'SELECT skill_name, level, is_verified FROM candidate_skills WHERE user_id = $1',
			[userId],
		);
		profile.skills = skillsResult.rows;

		// Fetch experience
		const expResult = await client.query(
			'SELECT * FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC',
			[userId],
		);
		profile.experience = expResult.rows;

		// Fetch education
		const eduResult = await client.query('SELECT * FROM education WHERE user_id = $1', [userId]);
		profile.education = eduResult.rows;

		if (buildCandidateProfileText) {
			return buildCandidateProfileText(profile);
		}

		// Inline fallback
		const parts = [];
		if (profile.headline) parts.push(`Headline: ${profile.headline}`);
		if (profile.bio) parts.push(`Bio: ${profile.bio}`);
		if (profile.skills?.length) {
			parts.push(
				`Skills: ${profile.skills.map((s) => `${s.skill_name} (level ${s.level})`).join(', ')}`,
			);
		}
		if (profile.experience?.length) {
			profile.experience.forEach((exp) => {
				parts.push(
					`Experience: ${exp.title} at ${exp.company_name || exp.company || 'Unknown'}. ${exp.description || ''}`,
				);
			});
		}
		if (profile.education?.length) {
			profile.education.forEach((edu) => {
				parts.push(
					`Education: ${edu.degree || ''} ${edu.field_of_study || ''} from ${edu.institution}`,
				);
			});
		}
		if (profile.years_experience) parts.push(`Years: ${profile.years_experience}`);
		if (profile.location) parts.push(`Location: ${profile.location}`);
		return parts.join('\n');
	} finally {
		client.release();
	}
}

/**
 * Fetch paginated companies from the database.
 */
async function fetchCompanies(page, limit) {
	const offset = (page - 1) * limit;
	const result = await pool.query(
		`SELECT id, name, description, industry, company_size, headquarters,
        founded_year, website, linkedin_url, logo_url, is_verified
       FROM companies
       ORDER BY is_verified DESC, name ASC
       LIMIT $1 OFFSET $2`,
		[limit, offset],
	);
	const countResult = await pool.query('SELECT COUNT(*) as total FROM companies');
	return {
		companies: result.rows,
		total: parseInt(countResult.rows[0].total, 10),
		page,
		limit,
		totalPages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit),
	};
}

/**
 * Fetch a single company by ID.
 */
async function fetchCompanyById(companyId) {
	const result = await pool.query(
		`SELECT id, name, description, industry, company_size, headquarters,
        founded_year, website, linkedin_url, logo_url, is_verified
       FROM companies WHERE id = $1`,
		[companyId],
	);
	return result.rows[0] || null;
}

// ─── GET /api/candidate/company-matches ─────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can view company matches' });
		}

		const page = Math.max(1, parseInt(req.query.page, 10) || 1);
		const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

		const cacheKey = getCacheKey(req.user.id, page, limit);
		const cached = getCached(cacheKey);
		if (cached) {
			return res.json({ success: true, ...cached, cached: true });
		}

		// Fetch candidate profile and companies in parallel
		const [profileText, companyData] = await Promise.all([
			buildProfileText(req.user.id),
			fetchCompanies(page, limit),
		]);

		if (!profileText.trim()) {
			return res.status(400).json({
				error: 'Profile incomplete',
				message: 'Complete your profile to see company matches.',
			});
		}

		if (companyData.companies.length === 0) {
			return res.json({
				success: true,
				matches: [],
				...companyData,
				cached: false,
			});
		}

		// Build company list for the AI prompt
		const companyList = companyData.companies.map((c) => ({
			id: c.id,
			name: c.name,
			industry: c.industry,
			description: c.description?.substring(0, 300) || '',
			size: c.company_size,
			headquarters: c.headquarters,
		}));

		// Single AI call for the entire batch
		const prompt = `Candidate profile:
${profileText.substring(0, 3000)}

Companies to evaluate:
${JSON.stringify(companyList)}

For each company, return a JSON array with objects containing:
- company_id: number
- match_score: number 0-100
- value_hook: one sentence on why this company needs this candidate
- match_reason: brief 1-sentence explanation
- outreach_difficulty: "easy" | "medium" | "hard"

Respond ONLY with the JSON array.`;

		const aiResponse = await aiProvider.chatCompletion([{ role: 'user', content: prompt }], {
			module: 'company-matching',
			feature: 'batch-match',
			maxTokens: 4096,
			temperature: 0.5,
			userId: req.user.id,
		});

		const parsed = safeParseJSON(aiResponse);
		const matchMap = new Map();
		if (Array.isArray(parsed)) {
			parsed.forEach((m) => {
				if (m && m.company_id != null) {
					matchMap.set(m.company_id, m);
				}
			});
		}

		// Merge company data with AI-generated match data
		const matches = companyData.companies.map((company) => {
			const aiMatch = matchMap.get(company.id) || {};
			return {
				id: company.id,
				name: company.name,
				industry: company.industry,
				logo_url: company.logo_url,
				match_score: typeof aiMatch.match_score === 'number' ? aiMatch.match_score : 50,
				value_hook: aiMatch.value_hook || `Opportunity at ${company.name}`,
				match_reason: aiMatch.match_reason || 'Profile may align with company needs.',
				outreach_difficulty: ['easy', 'medium', 'hard'].includes(aiMatch.outreach_difficulty)
					? aiMatch.outreach_difficulty
					: 'medium',
			};
		});

		// Sort by match score descending
		matches.sort((a, b) => b.match_score - a.match_score);

		const responsePayload = {
			matches,
			...companyData,
			cached: false,
		};

		setCached(cacheKey, responsePayload);
		res.json({ success: true, ...responsePayload });
	} catch (err) {
		sendError(res, err, 'Get company matches error');
	}
});

// ─── POST /api/candidate/company-matches/:id/analyze ────────────────────

router.post('/:id/analyze', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can analyze companies' });
		}

		const companyId = parseInt(req.params.id, 10);
		if (isNaN(companyId)) {
			return res.status(400).json({ error: 'Invalid company ID' });
		}

		const [profileText, company] = await Promise.all([
			buildProfileText(req.user.id),
			fetchCompanyById(companyId),
		]);

		if (!company) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const prompt = `Candidate profile:
${profileText.substring(0, 3000) || 'No profile data'}

Company: ${company.name}
Industry: ${company.industry || 'N/A'}
Description: ${company.description?.substring(0, 500) || 'N/A'}
Size: ${company.company_size || 'N/A'}
Headquarters: ${company.headquarters || 'N/A'}

Return JSON with:
- company_summary: 2-3 sentence summary of the company and its market position
- culture_fit: 1-2 sentence assessment of how the candidate fits the company culture
- growth_opportunities: 1-2 sentences on growth areas the candidate could contribute to
- key_decision_makers: array of 2-3 likely hiring decision maker roles (e.g., ["Engineering Manager", "CTO", "Talent Acquisition Lead"])
- recommended_approach: 1-2 sentence recommendation on how to approach this company

Respond ONLY with the JSON object.`;

		const aiResponse = await aiProvider.chatCompletion([{ role: 'user', content: prompt }], {
			module: 'company-matching',
			feature: 'company-analysis',
			maxTokens: 2048,
			temperature: 0.5,
			userId: req.user.id,
		});

		const parsed = safeParseJSON(aiResponse);
		if (!parsed || typeof parsed !== 'object') {
			return res.status(500).json({ error: 'Failed to parse AI analysis response' });
		}

		res.json({
			success: true,
			company_id: companyId,
			company_name: company.name,
			company_summary: parsed.company_summary || '',
			culture_fit: parsed.culture_fit || '',
			growth_opportunities: parsed.growth_opportunities || '',
			key_decision_makers: Array.isArray(parsed.key_decision_makers)
				? parsed.key_decision_makers
				: [],
			recommended_approach: parsed.recommended_approach || '',
		});
	} catch (err) {
		sendError(res, err, 'Analyze company error');
	}
});

// ─── POST /api/candidate/company-matches/:id/outreach ───────────────────

router.post('/:id/outreach', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can generate outreach strategies' });
		}

		const companyId = parseInt(req.params.id, 10);
		if (isNaN(companyId)) {
			return res.status(400).json({ error: 'Invalid company ID' });
		}

		const { notes } = req.body;

		const [profileText, company] = await Promise.all([
			buildProfileText(req.user.id),
			fetchCompanyById(companyId),
		]);

		if (!company) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const notesSection = notes ? `\nAdditional notes from candidate: ${notes}` : '';

		const prompt = `Candidate profile:
${profileText.substring(0, 3000) || 'No profile data'}

Target company: ${company.name}
Industry: ${company.industry || 'N/A'}
Description: ${company.description?.substring(0, 500) || 'N/A'}
${notesSection}

Return JSON with:
- personalized_hook: a compelling one-sentence hook for why this candidate is valuable to this specific company
- email_template: a short, professional cold email template (3-4 sentences max)
- linkedin_connection_message: a brief LinkedIn connection request message (2 sentences max)
- follow_up_strategy: a 1-sentence follow-up recommendation
- best_contact_method: "email", "linkedin", or "referral"

Respond ONLY with the JSON object.`;

		const aiResponse = await aiProvider.chatCompletion([{ role: 'user', content: prompt }], {
			module: 'company-matching',
			feature: 'outreach-strategy',
			maxTokens: 2048,
			temperature: 0.6,
			userId: req.user.id,
		});

		const parsed = safeParseJSON(aiResponse);
		if (!parsed || typeof parsed !== 'object') {
			return res.status(500).json({ error: 'Failed to parse AI outreach response' });
		}

		res.json({
			success: true,
			company_id: companyId,
			company_name: company.name,
			personalized_hook: parsed.personalized_hook || '',
			email_template: parsed.email_template || '',
			linkedin_connection_message: parsed.linkedin_connection_message || '',
			follow_up_strategy: parsed.follow_up_strategy || '',
			best_contact_method: ['email', 'linkedin', 'referral'].includes(parsed.best_contact_method)
				? parsed.best_contact_method
				: 'email',
		});
	} catch (err) {
		sendError(res, err, 'Generate outreach strategy error');
	}
});

module.exports = router;
