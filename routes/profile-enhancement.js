/**
 * Profile Enhancement API Routes — Issue #26
 *
 * Endpoints:
 *  POST /api/cv-upload                    — Upload CV, store file, return uploadId
 *  GET  /api/cv-uploads/:id               — Get CV upload with analysis
 *  POST /api/cv-uploads/:id/analyze       — Trigger AI analysis (mock)
 *  POST /api/linkedin/connect             — Save LinkedIn URL/profile data
 *  GET  /api/linkedin/tips/:candidateId   — Get AI-generated optimization tips (mock)
 *  POST /api/career-diagnosis             — Submit quiz answers, store results
 *  GET  /api/career-diagnosis/:candidateId — Get diagnosis results
 *  GET  /api/profile-tools/progress/:candidateId — Get progress across all 4 tools
 */

const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// ── Multer config (memory storage) ──
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
	fileFilter: (_req, file, cb) => {
		const allowed = [
			'application/pdf',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		];
		if (allowed.includes(file.mimetype)) cb(null, true);
		else cb(new Error('Invalid file type. Only PDF and Word documents allowed.'));
	},
});

// ── Helpers ──────────────────────────────────────────────

function asyncHandler(fn) {
	return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireOwnCandidate(req, res, next) {
	const paramId = parseInt(req.params.candidateId, 10);
	if (Number.isNaN(paramId)) {
		return res.status(400).json({ error: 'Invalid candidate ID' });
	}
	if (req.user.id !== paramId) {
		return res.status(403).json({ error: 'Access denied' });
	}
	next();
}

async function extractTextFromFile(buffer, mimetype) {
	if (mimetype === 'application/pdf') {
		const result = await pdfParse(buffer);
		return result.text || '';
	}
	if (
		mimetype === 'application/msword' ||
		mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	) {
		const result = await mammoth.extractRawText({ buffer });
		return result.value || '';
	}
	throw new Error('Unsupported file type for text extraction');
}

async function uploadToR2(buffer, originalname, mimetype) {
	const formData = new FormData();
	formData.append('file', buffer, { filename: originalname, contentType: mimetype });

	const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
			...formData.getHeaders(),
		},
		body: formData,
	});

	const uploadResult = await uploadRes.json();
	if (!uploadResult.success) {
		throw new Error(uploadResult.error?.message || 'File upload failed');
	}
	return uploadResult.file.url;
}

// ponytail: mock AI analysis — replace with real AI provider when ready
function mockCvAnalysis(text) {
	const words = text.split(/\s+/).length;
	const hasBulletPoints = /[•\-\*]/.test(text);
	const hasDates = /\b(19|20)\d{2}\b/.test(text);
	const hasEmail = /\S+@\S+\.\S+/.test(text);
	const hasPhone = /[\+\(]?\d[\d\s\-\(\)]{7,}\d/.test(text);
	const keywordMatches = {
		leadership: /\b(leadership|managed|led|team lead|supervisor)\b/gi,
		technical: /\b(javascript|python|java|react|node|sql|aws|docker|kubernetes)\b/gi,
		achievements: /\b(achieved|increased|improved|reduced|saved|grew|launched)\b/gi,
	};
	const keywordCounts = Object.fromEntries(
		Object.entries(keywordMatches).map(([k, re]) => [k, (text.match(re) || []).length]),
	);

	let score = 50;
	if (words >= 300 && words <= 800) score += 15;
	else if (words > 800) score += 5;
	if (hasBulletPoints) score += 10;
	if (hasDates) score += 10;
	if (hasEmail && hasPhone) score += 5;
	if (keywordCounts.achievements >= 3) score += 10;
	if (keywordCounts.technical >= 3) score += 5;
	score = Math.min(100, Math.max(0, score));

	const label = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 55 ? 'Average' : score >= 40 ? 'Needs Work' : 'Poor';

	return {
		score,
		scoreLabel: label,
		strengths: [
			...(hasBulletPoints ? [{ title: 'Readable format', description: 'Uses bullet points for clarity.' }] : []),
			...(hasDates ? [{ title: 'Clear timeline', description: 'Work history includes dates.' }] : []),
			...(keywordCounts.achievements > 0 ? [{ title: 'Results-oriented', description: 'Includes measurable achievements.' }] : []),
		].slice(0, 3),
		improvements: [
			...(words < 200 ? [{ title: 'Too short', description: 'Add more detail about your experience.', priority: 'high' }] : []),
			...(words > 1000 ? [{ title: 'Too long', description: 'Trim to 1-2 pages for most roles.', priority: 'medium' }] : []),
			...(!hasBulletPoints ? [{ title: 'Add bullet points', description: 'Use bullet points instead of paragraphs.', priority: 'high' }] : []),
			...(keywordCounts.technical < 2 ? [{ title: 'Add keywords', description: 'Include more relevant technical skills.', priority: 'medium' }] : []),
		].slice(0, 4),
		summary: `This CV scores ${score}/100 (${label}). ${words} words detected. ${hasBulletPoints ? 'Well-formatted with bullet points.' : 'Consider restructuring with bullet points.'}`,
		formattingTips: [
			'Use a clean, single-column layout for ATS compatibility.',
			'Keep font size between 10-12pt.',
			'Use consistent date formatting (MM/YYYY or Month Year).',
			'Limit to 1-2 pages for early-career, 2-3 for senior.',
		],
		keywordOptimization: [
			'Match job description keywords in your skills section.',
			'Use industry-standard job titles.',
			'Include both acronyms and full terms (e.g., "AWS" and "Amazon Web Services").',
			'Sprinkle action verbs: led, built, designed, implemented, optimized.',
		],
		atsCompatibility: {
			score: hasBulletPoints && hasDates ? Math.min(95, score + 5) : score,
			notes: hasBulletPoints
				? 'ATS-friendly structure detected.'
				: 'Avoid tables, headers/footers, and graphics for better ATS parsing.',
		},
	};
}

// ponytail: mock LinkedIn tips — replace with real AI provider when ready
function mockLinkedInTips(profileData) {
	const tips = [];
	const missingSections = [];

	if (!profileData.headline || profileData.headline.length < 20) {
		tips.push({
			category: 'headline',
			title: 'Strengthen your headline',
			description: 'Your headline is the first thing recruiters see. Include your role, specialty, and value proposition.',
			priority: 'high',
			actionable: 'Example: "Senior Frontend Engineer | React & TypeScript | Scaling products from 0 to 1M users"',
		});
		missingSections.push('headline');
	}
	if (!profileData.summary || profileData.summary.length < 100) {
		tips.push({
			category: 'about',
			title: 'Write a compelling About section',
			description: 'Use the About section to tell your story. 3-5 short paragraphs work best.',
			priority: 'high',
			actionable: 'Start with your current role, then highlight 2-3 key achievements, and end with what you\'re looking for.',
		});
		missingSections.push('about');
	}
	if (!profileData.skills || profileData.skills.length < 5) {
		tips.push({
			category: 'skills',
			title: 'Add more skills',
			description: 'Profiles with 5+ relevant skills get up to 17x more profile views.',
			priority: 'medium',
			actionable: 'Add at least 10 skills, prioritizing those in your target job descriptions.',
		});
		missingSections.push('skills');
	}

	tips.push(
		{
			category: 'networking',
			title: 'Grow your network strategically',
			description: 'Connect with people in your target industry, not just colleagues.',
			priority: 'medium',
			actionable: 'Send 5 personalized connection requests per week to hiring managers or senior engineers.',
		},
		{
			category: 'content',
			title: 'Post weekly content',
			description: 'Active posters are 9x more likely to be contacted by recruiters.',
			priority: 'low',
			actionable: 'Share one thing you learned, built, or observed each week.',
		},
	);

	const completeness = Math.max(0, 100 - missingSections.length * 25);

	return {
		profileStatus: {
			connected: !!profileData.linkedin_url,
			completenessScore: completeness,
			missingSections,
			linkedinUrl: profileData.linkedin_url,
		},
		tips,
		headlineSuggestions: [
			`${profileData.headline || 'Software Engineer'} | Building scalable systems`,
			`${profileData.headline || 'Software Engineer'} | TypeScript, Node.js, AWS`,
			`${profileData.headline || 'Software Engineer'} | Product-focused developer`,
		],
		aboutSectionTemplate:
			"I'm a [role] with [X] years of experience in [domain].\n\nCurrently, I [what you do now + impact]. Previously, I [notable past role + achievement].\n\nI'm passionate about [2-3 interests] and always open to [what you're looking for].",
		weeklyActionPlan: [
			{ day: 'Monday', action: 'Update headline and About section' },
			{ day: 'Tuesday', action: 'Add 3 new skills and request endorsements' },
			{ day: 'Wednesday', action: 'Engage with 3 posts from industry leaders' },
			{ day: 'Thursday', action: 'Send 5 personalized connection requests' },
			{ day: 'Friday', action: 'Publish a short post about your week' },
		],
		summary: `Your LinkedIn profile is ${completeness}% complete. Focus on ${missingSections.join(' and ') || 'networking and content'} to increase visibility.`,
	};
}

// ponytail: mock career diagnosis — replace with real AI provider when ready
function mockCareerDiagnosis(answers) {
	const archetypeNames = ['The Strategic Leader', 'The Technical Builder', 'The Creative Problem-Solver', 'The People Connector'];
	const archetype = archetypeNames[answers.length % archetypeNames.length];

	return {
		careerArchetype: {
			name: archetype,
			description: `You naturally gravitate toward ${archetype.toLowerCase().replace('the ', '')} roles where you can leverage your strengths in analysis and execution.`,
		},
		recommendedPaths: [
			{
				pathName: 'Engineering Management',
				fitScore: 82,
				description: 'Lead technical teams while staying close to the code.',
				timeToAchievable: '2-4 years',
				requiredSkills: ['Leadership', 'System Design', 'Communication'],
				skillsToDevelop: ['Stakeholder Management', 'Budgeting', 'Hiring'],
			},
			{
				pathName: 'Staff Engineer',
				fitScore: 76,
				description: 'Deep technical expertise across multiple domains.',
				timeToAchievable: '3-5 years',
				requiredSkills: ['Architecture', 'Mentoring', 'Cross-team Collaboration'],
				skillsToDevelop: ['Influence without authority', 'Technical Writing'],
			},
		],
		strengths: ['Analytical thinking', 'Strong communication', 'Adaptability'],
		growthAreas: ['Public speaking', 'Strategic planning', 'Delegation'],
		recommendedRoles: [
			{ title: 'Engineering Manager', whyFits: 'Combines technical depth with people leadership.', salaryRange: '$140K - $200K' },
			{ title: 'Staff Software Engineer', whyFits: 'Leverages your technical breadth and mentoring skills.', salaryRange: '$160K - $250K' },
		],
		actionPlan: [
			{ phase: 'Short-term (0-6 months)', actions: ['Complete a leadership course', 'Mentor a junior engineer', 'Lead a cross-team project'], timeline: '0-6 months' },
			{ phase: 'Medium-term (6-18 months)', actions: ['Take on tech lead responsibilities', 'Build a personal brand via blogging'], timeline: '6-18 months' },
			{ phase: 'Long-term (18+ months)', actions: ['Transition into EM or Staff role', 'Speak at a tech conference'], timeline: '18+ months' },
		],
		summary: `As a ${archetype}, you're well-positioned for growth into technical leadership. Focus on communication and strategic thinking to accelerate your trajectory.`,
	};
}

// ── Ensure progress row exists ───────────────────────────
async function ensureProgress(userId, toolType, statusOverride) {
	await pool.query(
		`
      INSERT INTO profile_tool_progress (user_id, tool_type, status)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, tool_type) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW()
    `,
		[userId, toolType, statusOverride || 'not_started'],
	);
}

async function markCompleted(userId, toolType) {
	await pool.query(
		`
      INSERT INTO profile_tool_progress (user_id, tool_type, status, completed_at)
      VALUES ($1, $2, 'completed', NOW())
      ON CONFLICT (user_id, tool_type) DO UPDATE SET
        status = 'completed',
        completed_at = COALESCE(profile_tool_progress.completed_at, NOW()),
        updated_at = NOW()
    `,
		[userId, toolType],
	);
}

// ════════════════════════════════════════════════════════════════════════
// POST /api/cv-upload — Upload CV
// ════════════════════════════════════════════════════════════════════════
router.post('/cv-upload', authMiddleware, upload.single('cv'), asyncHandler(async (req, res) => {
	const userId = req.user.id;
	if (!req.file) {
		return res.status(400).json({ error: 'No CV file uploaded' });
	}

	const fileUrl = await uploadToR2(req.file.buffer, req.file.originalname, req.file.mimetype);

	// Extract text
	let parsedText = '';
	try {
		parsedText = await extractTextFromFile(req.file.buffer, req.file.mimetype);
	} catch (err) {
		console.warn('[cv-upload] Text extraction failed (non-fatal):', err.message);
	}

	const result = await pool.query(
		`
      INSERT INTO cv_uploads (user_id, file_url, file_name, parsed_text, status)
      VALUES ($1, $2, $3, $4, 'uploaded')
      RETURNING id, user_id, file_url, file_name, status, created_at
    `,
		[userId, fileUrl, req.file.originalname, parsedText],
	);

	await ensureProgress(userId, 'cv_review', 'in_progress');

	res.status(201).json({
		success: true,
		uploadId: result.rows[0].id,
		upload: result.rows[0],
	});
}));

// ════════════════════════════════════════════════════════════════════════
// GET /api/cv-uploads/:id — Get CV upload with analysis
// ════════════════════════════════════════════════════════════════════════
router.get('/cv-uploads/:id', authMiddleware, asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const uploadId = parseInt(req.params.id, 10);
	if (Number.isNaN(uploadId)) {
		return res.status(400).json({ error: 'Invalid upload ID' });
	}

	const result = await pool.query(
		`
      SELECT id, user_id, file_url, file_name, parsed_text, analysis_result, status, created_at, updated_at
      FROM cv_uploads
      WHERE id = $1 AND user_id = $2
    `,
		[uploadId, userId],
	);

	if (result.rows.length === 0) {
		return res.status(404).json({ error: 'CV upload not found' });
	}

	res.json({ success: true, upload: result.rows[0] });
}));

// ════════════════════════════════════════════════════════════════════════
// POST /api/cv-uploads/:id/analyze — Trigger AI analysis (mock)
// ════════════════════════════════════════════════════════════════════════
router.post('/cv-uploads/:id/analyze', authMiddleware, asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const uploadId = parseInt(req.params.id, 10);
	if (Number.isNaN(uploadId)) {
		return res.status(400).json({ error: 'Invalid upload ID' });
	}

	const uploadResult = await pool.query(
		`SELECT parsed_text, status FROM cv_uploads WHERE id = $1 AND user_id = $2`,
		[uploadId, userId],
	);
	if (uploadResult.rows.length === 0) {
		return res.status(404).json({ error: 'CV upload not found' });
	}

	const { parsed_text, status } = uploadResult.rows[0];
	if (status === 'analyzed') {
		return res.status(409).json({ error: 'CV already analyzed', code: 'ALREADY_ANALYZED' });
	}

	// Update to parsing
	await pool.query(`UPDATE cv_uploads SET status = 'parsing', updated_at = NOW() WHERE id = $1`, [uploadId]);

	let analysisResult = {};
	try {
		if (parsed_text && parsed_text.trim().length >= 50) {
			analysisResult = mockCvAnalysis(parsed_text);
		} else {
			analysisResult = {
				score: 0,
				scoreLabel: 'Unable to analyze',
				strengths: [],
				improvements: [{ title: 'Empty or unreadable CV', description: 'Could not extract sufficient text for analysis.', priority: 'high' }],
				summary: 'The uploaded file appears to be empty, unreadable, or image-based. Please upload a text-based PDF or Word document.',
				formattingTips: [],
				keywordOptimization: [],
				atsCompatibility: { score: 0, notes: 'No text content detected.' },
			};
		}
		await pool.query(
			`UPDATE cv_uploads SET status = 'analyzed', analysis_result = $1, updated_at = NOW() WHERE id = $2`,
			[JSON.stringify(analysisResult), uploadId],
		);
		await markCompleted(userId, 'cv_review');
	} catch (err) {
		console.error('[cv-analyze] Analysis failed:', err.message);
		await pool.query(
			`UPDATE cv_uploads SET status = 'failed', updated_at = NOW() WHERE id = $1`,
			[uploadId],
		);
		return res.status(500).json({ error: 'Analysis failed' });
	}

	res.json({ success: true, analysis: analysisResult });
}));

// ════════════════════════════════════════════════════════════════════════
// POST /api/linkedin/connect — Save LinkedIn URL/profile data
// ════════════════════════════════════════════════════════════════════════
router.post('/linkedin/connect', authMiddleware, asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const { linkedInUrl, headline, summary, skills } = req.body;

	if (!linkedInUrl) {
		return res.status(400).json({ error: 'LinkedIn URL is required' });
	}

	// Normalize URL
	let normalizedUrl = String(linkedInUrl).trim();
	if (!normalizedUrl.startsWith('http')) {
		normalizedUrl = 'https://' + normalizedUrl;
	}
	try {
		new URL(normalizedUrl);
	} catch {
		return res.status(400).json({ error: 'Invalid LinkedIn URL' });
	}

	const result = await pool.query(
		`
      INSERT INTO linkedin_profiles (user_id, linkedin_url, headline, summary, skills, connected_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        linkedin_url = EXCLUDED.linkedin_url,
        headline = COALESCE(EXCLUDED.headline, linkedin_profiles.headline),
        summary = COALESCE(EXCLUDED.summary, linkedin_profiles.summary),
        skills = COALESCE(EXCLUDED.skills, linkedin_profiles.skills),
        updated_at = NOW()
      RETURNING *
    `,
		[userId, normalizedUrl, headline || null, summary || null, JSON.stringify(skills || [])],
	);

	await ensureProgress(userId, 'linkedin', 'in_progress');

	res.json({ success: true, profile: result.rows[0] });
}));

// ════════════════════════════════════════════════════════════════════════
// GET /api/linkedin/tips/:candidateId — Get AI-generated optimization tips
// ════════════════════════════════════════════════════════════════════════
router.get('/linkedin/tips/:candidateId', authMiddleware, requireOwnCandidate, asyncHandler(async (req, res) => {
	const userId = req.user.id;

	const profileResult = await pool.query(
		`SELECT linkedin_url, headline, summary, skills FROM linkedin_profiles WHERE user_id = $1`,
		[userId],
	);

	const profileData = profileResult.rows[0] || {};
	const tips = mockLinkedInTips(profileData);

	await ensureProgress(userId, 'linkedin', 'in_progress');

	res.json({ success: true, ...tips });
}));

// ════════════════════════════════════════════════════════════════════════
// POST /api/career-diagnosis — Submit quiz answers, store results
// ════════════════════════════════════════════════════════════════════════
router.post('/career-diagnosis', authMiddleware, asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const { quizAnswers } = req.body;

	if (!Array.isArray(quizAnswers) || quizAnswers.length === 0) {
		return res.status(400).json({ error: 'Quiz answers are required' });
	}

	// Mock diagnosis
	const diagnosis = mockCareerDiagnosis(quizAnswers);

	const result = await pool.query(
		`
      INSERT INTO career_diagnoses (user_id, quiz_answers, career_path, strengths, recommendations, completed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        quiz_answers = EXCLUDED.quiz_answers,
        career_path = EXCLUDED.career_path,
        strengths = EXCLUDED.strengths,
        recommendations = EXCLUDED.recommendations,
        completed_at = NOW()
      RETURNING *
    `,
		[
			userId,
			JSON.stringify(quizAnswers),
			diagnosis.careerArchetype.name,
			JSON.stringify(diagnosis.strengths),
			JSON.stringify(diagnosis.recommendedPaths),
		],
	);

	await markCompleted(userId, 'career_diagnosis');

	res.json({
		success: true,
		diagnosis: {
			id: result.rows[0].id,
			...diagnosis,
		},
	});
}));

// ════════════════════════════════════════════════════════════════════════
// GET /api/career-diagnosis/:candidateId — Get diagnosis results
// ════════════════════════════════════════════════════════════════════════
router.get('/career-diagnosis/:candidateId', authMiddleware, requireOwnCandidate, asyncHandler(async (req, res) => {
	const userId = req.user.id;

	const result = await pool.query(
		`SELECT * FROM career_diagnoses WHERE user_id = $1`,
		[userId],
	);

	if (result.rows.length === 0) {
		return res.status(404).json({ error: 'Career diagnosis not found' });
	}

	const row = result.rows[0];
	res.json({
		success: true,
		diagnosis: {
			id: row.id,
			quizAnswers: row.quiz_answers,
			careerPath: row.career_path,
			strengths: row.strengths,
			recommendations: row.recommendations,
			completedAt: row.completed_at,
		},
	});
}));

// ════════════════════════════════════════════════════════════════════════
// GET /api/profile-tools/progress/:candidateId — Get progress across all 4 tools
// ════════════════════════════════════════════════════════════════════════
router.get('/profile-tools/progress/:candidateId', authMiddleware, requireOwnCandidate, asyncHandler(async (req, res) => {
	const userId = req.user.id;

	// Ensure all 4 tool rows exist
	const tools = ['cv_review', 'linkedin', 'career_diagnosis', 'coaching'];
	for (const tool of tools) {
		await ensureProgress(userId, tool);
	}

	const result = await pool.query(
		`
      SELECT tool_type, status, completed_at, updated_at
      FROM profile_tool_progress
      WHERE user_id = $1
      ORDER BY tool_type
    `,
		[userId],
	);

	// Build a complete map including missing tools
	const progressMap = Object.fromEntries(tools.map((t) => [t, { toolType: t, status: 'not_started', completedAt: null, updatedAt: null }]));
	for (const row of result.rows) {
		progressMap[row.tool_type] = {
			toolType: row.tool_type,
			status: row.status,
			completedAt: row.completed_at,
			updatedAt: row.updated_at,
		};
	}

	const progress = tools.map((t) => progressMap[t]);
	const completedCount = progress.filter((p) => p.status === 'completed').length;
	const overallPercent = Math.round((completedCount / tools.length) * 100);

	res.json({
		success: true,
		progress,
		overallPercent,
		completedCount,
		totalTools: tools.length,
	});
}));

module.exports = router;
