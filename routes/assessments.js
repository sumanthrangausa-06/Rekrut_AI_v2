const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { chat, handleAIError } = require('../lib/polsia-ai');
const omniscoreService = require('../services/omniscore');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const { AuditLogger } = require('../services/auditLogService');
const { notifyUser } = require('../lib/notify');

// Retake policy for skill self-assessments: a completed assessment blocks a
// new start for this many days (mirrors aptitude's retake_lockout_days default
// of 30). Skills have no per-skill config row, so this is a code constant —
// no admin UI. See POST /start below and canRetake().
const SKILL_RETAKE_LOCKOUT_DAYS = 30;

// Mirrors canRetake() in routes/aptitude.js: true when the user may start a
// new attempt, false while a completed attempt is inside the lockout window.
function canRetakeSkill(lockoutDays, lastCompletedAt) {
	if (!lastCompletedAt) return true;
	if (!lockoutDays || lockoutDays <= 0) return true;
	const lockoutEnd = new Date(lastCompletedAt);
	lockoutEnd.setDate(lockoutEnd.getDate() + lockoutDays);
	return new Date() >= lockoutEnd;
}

// ── #1653 (#1603 Phase C, story C1) — catalogue availability ──────────────
// TWIN of scripts/audit-assessment-coverage.js: BANDS (audit script ~line 37)
// and the servable fold in its main() are ported here as BANDS +
// computeTopicAvailability. If one changes, the other must — the audit job
// and this API must never disagree about what is servable.
// Servable counts ONLY review_status='approved' rows (design §7 rule 6);
// the grouped query in loadCatalogTables below is the only counter and it
// filters on approved — this helper folds already-approved counts.
// Bands overlap deliberately (§7): easy {1,2} / medium {2,3,4} / hard {4,5}
// share boundary levels, so a shared-level row counts in EACH band it
// belongs to — but exactly once within a single configuration.
// `mixed` is a computed union (§4.6): servable(mixed, band) =
// servable(mcq, band) + servable(short_answer, band); the member formats
// are disjoint so the sum is exact. Coding is NEVER a member of mixed.
const BANDS = {
	easy: [1, 2],
	medium: [2, 3, 4],
	hard: [4, 5],
};
// §7 rule 2 activation floor: the smallest offered count. A topic reads
// available only when its best (format, band) configuration reaches it.
const CATALOG_AVAILABLE_FLOOR = 10;

// countRows: approved-only grouped counts for ONE topic —
// [{ format, difficulty_level, n }] as selected by loadCatalogTables
// (topic_id, format, difficulty_level, COUNT(*) — nothing else, R4).
function computeTopicAvailability(countRows) {
	const zeroBands = () => ({ easy: 0, medium: 0, hard: 0 });
	const formats = { mcq: zeroBands(), short_answer: zeroBands(), coding: zeroBands(), mixed: zeroBands() };
	const levels = { mcq: {}, short_answer: {}, coding: {} };
	for (const row of countRows || []) {
		if (!levels[row.format]) continue;
		const level = parseInt(row.difficulty_level, 10);
		levels[row.format][level] = (levels[row.format][level] || 0) + (parseInt(row.n, 10) || 0);
	}
	let maxCount = 0;
	for (const format of ['mcq', 'short_answer', 'coding']) {
		for (const band of Object.keys(BANDS)) {
			const n = BANDS[band].reduce((sum, lvl) => sum + (levels[format][lvl] || 0), 0);
			formats[format][band] = n;
			if (n > maxCount) maxCount = n;
		}
	}
	for (const band of Object.keys(BANDS)) {
		const n = formats.mcq[band] + formats.short_answer[band];
		formats.mixed[band] = n;
		if (n > maxCount) maxCount = n;
	}
	return { formats, maxCount, available: maxCount >= CATALOG_AVAILABLE_FLOOR };
}

// ── #1653 (C1) — catalogue table reads shared by /available and /catalog ──
// Explicit column allowlists only (R4): the counts query selects ONLY
// topic_id, format, difficulty_level, COUNT(*) — never question content.
// The progress read is scoped to the requesting user on every table it
// touches (WHERE user_id = $1) and is completed-attempts only, so an
// abandoned session or an unsubmitted (completed_at NULL) verification
// row can never move can_retake or progress (§2.3 pinning). The latest
// score comes from a DISTINCT ON read ordered by completed_at DESC —
// a MAX() would silently duplicate best_score into last_score (§2.4).
// Internal alias is last_completed_at; /available maps it to the frozen
// external field name last_attempted (§4.4).
async function loadCatalogTables(userId) {
	const subjectsResult = await pool.query(
		`SELECT id, slug, name, category, icon, description, sort_order
     FROM assessment_subjects
     WHERE is_active = true
     ORDER BY sort_order ASC, id ASC`,
	);
	const topicsResult = await pool.query(
		`SELECT id, subject_id, slug, name, description, legacy_skill_name, sort_order
     FROM assessment_topics
     WHERE is_active = true
     ORDER BY sort_order ASC, id ASC`,
	);
	const countsResult = await pool.query(
		`SELECT topic_id, format, difficulty_level, COUNT(*)::int AS n
     FROM assessment_questions
     WHERE topic_id IS NOT NULL AND review_status = 'approved'
     GROUP BY topic_id, format, difficulty_level`,
	);
	const progressResult = await pool.query(
		`WITH latest AS (
       SELECT DISTINCT ON (sa.skill_id)
              sa.skill_id, sa.score AS last_score, sa.completed_at AS last_completed_at
       FROM skill_assessments sa
       WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL
       ORDER BY sa.skill_id, sa.completed_at DESC
     ),
     agg AS (
       SELECT sa.skill_id, COUNT(*)::int AS assessment_count, MAX(sa.score) AS best_score
       FROM skill_assessments sa
       WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL
       GROUP BY sa.skill_id
     )
     SELECT cs.id AS skill_id, cs.skill_name, cs.category, cs.is_verified, cs.verified_score,
            COALESCE(agg.assessment_count, 0) AS assessment_count,
            agg.best_score, latest.last_score, latest.last_completed_at
     FROM candidate_skills cs
     LEFT JOIN agg ON agg.skill_id = cs.id
     LEFT JOIN latest ON latest.skill_id = cs.id
     WHERE cs.user_id = $1
     ORDER BY cs.is_verified ASC, cs.created_at DESC`,
		[userId],
	);
	// #1656 (C3, §3.7): the per-(user, topic) progress read model — over
	// skill_assessments joined to the session that produced them, keyed
	// by assessment_sessions.topic_id. Completed attempts only, exactly
	// like the skill-keyed read above: an abandoned session writes no
	// skill_assessments row and can never appear here. The latest score
	// comes from a LATERAL read ordered by completed_at DESC — a MAX()
	// would silently duplicate best into last (§2.4 pitfall, C1).
	const topicProgressResult = await pool.query(
		`WITH agg AS (
       SELECT sess.topic_id AS topic_id, COUNT(*)::int AS attempts, MAX(sa.score) AS best_score
       FROM skill_assessments sa
       JOIN assessment_sessions sess ON sess.id = sa.session_id
       WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL AND sess.topic_id IS NOT NULL
       GROUP BY sess.topic_id
     )
     SELECT agg.topic_id, agg.attempts, agg.best_score, lat.last_score, lat.last_completed_at
     FROM agg
     JOIN LATERAL (
       SELECT sa2.score AS last_score, sa2.completed_at AS last_completed_at
       FROM skill_assessments sa2
       JOIN assessment_sessions sess2 ON sess2.id = sa2.session_id
       WHERE sa2.user_id = $1 AND sa2.completed_at IS NOT NULL AND sess2.topic_id = agg.topic_id
       ORDER BY sa2.completed_at DESC, sa2.id DESC
       LIMIT 1
     ) lat ON true`,
		[userId],
	);
	return {
		subjects: subjectsResult.rows,
		topics: topicsResult.rows,
		counts: countsResult.rows,
		progress: progressResult.rows,
		topicProgress: topicProgressResult.rows,
	};
}

// ── #1654 (#1603 Phase C, story C2) — configured starts ───────────────────
// The §3.6 session snapshot columns (migration 280) become load-bearing:
// every NEW start records { subject_id, topic_id, format, difficulty_band,
// total_questions } — chosen configurations verbatim, legacy-body starts
// via the recorded defaults (§4.2/§8: mixed / medium / 10, start 3) — so
// serving, the §5.2 band clamp, and completion all read ONE code path.
// Sessions already in flight keep NULL config and finish under the rules
// they started with (§8): total reads as 10, adaptation stays [1,5].
const BAND_START = { easy: 1, medium: 3, hard: 4 };
const BAND_RANGE = { easy: [1, 2], medium: [2, 4], hard: [4, 5] };
const CONFIG_FORMATS = ['mcq', 'short_answer', 'mixed', 'coding'];
const CONFIG_COUNTS = [10, 25, 50, 100];

// Coding serving is gated OFF until the #118 disposition flips this flag
// (design §3.5/C4). A coding start while OFF is an honest 503 (STOP 1 Q4),
// never a silent substitution to another format.
function assessmentsCodingEnabled() {
	return process.env.ASSESSMENTS_CODING_ENABLED === 'true';
}

// §5.2 clamp: a band session's difficulty never leaves its band; a NULL
// band (in-flight legacy) keeps today's unbounded [1,5].
function clampToBand(difficulty, band) {
	if (!band || !BAND_RANGE[band]) return Math.min(5, Math.max(1, difficulty));
	const [lo, hi] = BAND_RANGE[band];
	return Math.min(hi, Math.max(lo, difficulty));
}

// The promised count for a session: its snapshot, or the legacy 10.
function sessionTotal(session) {
	return session?.total_questions ?? LEGACY_TOTAL_QUESTIONS;
}

// Per-topic counts variant for pre-flight and the start-time re-check
// (§4.1): the same grouped approved-only shape as loadCatalogTables'
// counter, scoped to ONE topic — never the whole-bank load.
async function loadTopicCounts(runner, topicId) {
	const result = await runner.query(
		`SELECT format, difficulty_level, COUNT(*)::int AS n
     FROM assessment_questions
     WHERE topic_id = $1 AND review_status = 'approved'
     GROUP BY format, difficulty_level`,
		[topicId],
	);
	return result.rows;
}

async function topicServable(runner, topicId, format, band) {
	const availability = computeTopicAvailability(await loadTopicCounts(runner, topicId));
	return availability.formats[format][band];
}

// ── #1656 (C3) — assessment sets (§3.3, R1/R2) ─────────────────────────────
// A set serves iff it is active, belongs to the session's topic, matches
// the band exactly, and matches the format per §4.6: exact match, OR a
// mixed session drawing an mcq/short_answer set (the session then serves
// that single format and the set is what the candidate actually got).
// Every other pairing is incompatible — the honest 400, never a fallback.
function setMatchesSession(set, topicId, format, difficultyBand) {
	if (!set || set.is_active === false) return false;
	if (set.topic_id !== topicId) return false;
	if (set.difficulty_band !== difficultyBand) return false;
	if (set.format === format) return true;
	return format === 'mixed' && (set.format === 'mcq' || set.format === 'short_answer');
}

async function loadSetById(runner, setId) {
	const result = await runner.query('SELECT * FROM assessment_sets WHERE id = $1', [setId]);
	return result.rows[0] || null;
}

// Servable supply FOR A SET is its own approved membership (§7 rule 6
// applies to set questions exactly as to pool rows) — never the topic pool.
async function setApprovedCount(runner, setId) {
	const result = await runner.query(
		`SELECT COUNT(*)::int AS n
     FROM assessment_set_questions sq
     JOIN assessment_questions q ON q.id = sq.question_id
     WHERE sq.set_id = $1 AND q.review_status = 'approved'`,
		[setId],
	);
	return parseInt(result.rows[0]?.n, 10) || 0;
}

// The set's servable question ids in position order (approved only — a
// set question that loses approval mid-session simply stops being
// servable, which is the R2 starvation path, never a pool draw).
async function loadSetQuestionIds(runner, setId) {
	const result = await runner.query(
		`SELECT sq.question_id
     FROM assessment_set_questions sq
     JOIN assessment_questions q ON q.id = sq.question_id
     WHERE sq.set_id = $1 AND q.review_status = 'approved'
     ORDER BY sq.position ASC`,
		[setId],
	);
	return result.rows.map((r) => r.question_id);
}

// R2 auto-pick: among the active sets for the topic, the one this user
// has gone longest without completing (never completed first, then the
// oldest last completion, then the lowest id). Format/band compatibility
// (§4.6) and non-empty approved membership are applied here — an empty
// or incompatible set is never picked.
async function pickAutoSet(runner, topicId, userId, format, difficultyBand) {
	const result = await runner.query(
		`SELECT st.id, st.topic_id, st.name, st.format, st.difficulty_band, st.is_active,
            (SELECT MAX(sess.completed_at) FROM assessment_sessions sess
              WHERE sess.set_id = st.id AND sess.user_id = $2 AND sess.status = 'completed') AS last_completed_at,
            (SELECT COUNT(*)::int FROM assessment_set_questions sq
              JOIN assessment_questions q ON q.id = sq.question_id
              WHERE sq.set_id = st.id AND q.review_status = 'approved') AS question_count
     FROM assessment_sets st
     WHERE st.topic_id = $1 AND st.is_active = true
     ORDER BY last_completed_at ASC NULLS FIRST, st.id ASC`,
		[topicId, userId],
	);
	return (
		result.rows.find(
			(s) => parseInt(s.question_count, 10) > 0 && setMatchesSession(s, topicId, format, difficultyBand),
		) || null
	);
}

async function findTopicById(runner, topicId) {
	const result = await runner.query('SELECT * FROM assessment_topics WHERE id = $1', [topicId]);
	return result.rows[0] || null;
}

// §3.6: a subject's default topic is the one carrying its legacy skill
// name (SF-8: exactly one per subject, partial unique index, migration 279).
async function findDefaultTopicForSubject(runner, subjectId) {
	const result = await runner.query(
		`SELECT * FROM assessment_topics
     WHERE subject_id = $1 AND legacy_skill_name IS NOT NULL
     ORDER BY sort_order ASC, id ASC LIMIT 1`,
		[subjectId],
	);
	return result.rows[0] || null;
}

async function findDefaultTopicBySkillName(runner, skillName) {
	const result = await runner.query(
		'SELECT * FROM assessment_topics WHERE LOWER(legacy_skill_name) = LOWER($1)',
		[skillName],
	);
	return result.rows[0] || null;
}

// §3.6 subject-legacy-name → candidate_skills resolution: the exact
// lookup-or-create the legacy /start path has always run (by id, else by
// name, else auto-create), shared by both start bodies.
async function resolveCandidateSkill(client, userId, { skillId, skillName, category } = {}) {
	let skill;
	if (skillId) {
		const skillResult = await client.query(
			'SELECT * FROM candidate_skills WHERE id = $1 AND user_id = $2',
			[skillId, userId],
		);
		skill = skillResult.rows[0];
	}
	if (!skill && skillName) {
		const existingResult = await client.query(
			'SELECT * FROM candidate_skills WHERE user_id = $1 AND LOWER(skill_name) = LOWER($2)',
			[userId, skillName],
		);
		if (existingResult.rows.length > 0) {
			skill = existingResult.rows[0];
		} else {
			const insertResult = await client.query(
				`
          INSERT INTO candidate_skills (user_id, skill_name, category, level)
          VALUES ($1, $2, $3, 1)
          RETURNING *
        `,
				[userId, skillName, category || 'technical'],
			);
			skill = insertResult.rows[0];
		}
	}
	return skill || null;
}

// Skill catalog - available to all candidates without pre-existing skills
const SKILL_CATALOG = [
	{
		name: 'JavaScript',
		category: 'technical',
		icon: 'JS',
		description: 'Core JS, ES6+, async/await, closures, prototypes',
		difficulty: 'Adaptive',
	},
	{
		name: 'Python',
		category: 'technical',
		icon: 'PY',
		description: 'Core Python, data structures, OOP, standard library',
		difficulty: 'Adaptive',
	},
	{
		name: 'React',
		category: 'technical',
		icon: 'RE',
		description: 'Components, hooks, state management, lifecycle',
		difficulty: 'Adaptive',
	},
	{
		name: 'Node.js',
		category: 'technical',
		icon: 'NJ',
		description: 'Express, APIs, async patterns, middleware',
		difficulty: 'Adaptive',
	},
	{
		name: 'SQL',
		category: 'technical',
		icon: 'SQL',
		description: 'Queries, joins, indexing, optimization, transactions',
		difficulty: 'Adaptive',
	},
	{
		name: 'TypeScript',
		category: 'technical',
		icon: 'TS',
		description: 'Types, interfaces, generics, type guards',
		difficulty: 'Adaptive',
	},
	{
		name: 'Java',
		category: 'technical',
		icon: 'JV',
		description: 'OOP, collections, multithreading, design patterns',
		difficulty: 'Adaptive',
	},
	{
		name: 'CSS & HTML',
		category: 'technical',
		icon: 'CSS',
		description: 'Flexbox, Grid, responsive design, accessibility',
		difficulty: 'Adaptive',
	},
	{
		name: 'AWS',
		category: 'technical',
		icon: 'AWS',
		description: 'EC2, S3, Lambda, IAM, CloudFormation',
		difficulty: 'Adaptive',
	},
	{
		name: 'Docker',
		category: 'technical',
		icon: 'DK',
		description: 'Containers, images, compose, networking',
		difficulty: 'Adaptive',
	},
	{
		name: 'Git',
		category: 'technical',
		icon: 'GIT',
		description: 'Branching, merging, rebasing, workflows',
		difficulty: 'Adaptive',
	},
	{
		name: 'Data Analysis',
		category: 'analytical',
		icon: 'DA',
		description: 'Statistics, visualization, pandas, Excel formulas',
		difficulty: 'Adaptive',
	},
	{
		name: 'System Design',
		category: 'technical',
		icon: 'SD',
		description: 'Scalability, databases, caching, load balancing',
		difficulty: 'Adaptive',
	},
	{
		name: 'Project Management',
		category: 'soft_skill',
		icon: 'PM',
		description: 'Agile, planning, risk management, stakeholders',
		difficulty: 'Adaptive',
	},
	{
		name: 'Communication',
		category: 'soft_skill',
		icon: 'CM',
		description: 'Written, verbal, presentation, feedback',
		difficulty: 'Adaptive',
	},
	{
		name: 'Machine Learning',
		category: 'technical',
		icon: 'ML',
		description: 'Algorithms, neural networks, training, evaluation',
		difficulty: 'Adaptive',
	},
];

// Get skill catalog with user's assessment history
// Get skill catalog with user's assessment history — DUAL-READ constant
// path (#1653, design §6 step 3). This is the pre-C1 GET /available body,
// extracted unchanged: it serves ONLY when the catalogue tables return
// zero subject rows (fresh install before seed). SKILL_CATALOG stays the
// fallback here and the /recruiter/catalog source until the §6 step 5
// contract (Sumanth-gated, not this story).
async function buildAvailableFromConstant(userId) {
	// Get user's existing skills and assessment data
	const userSkillsResult = await pool.query(
		`
      SELECT cs.id, cs.skill_name, cs.category, cs.level, cs.is_verified, cs.verified_score,
             COUNT(sa.id) as assessment_count,
             MAX(sa.score) as best_score,
             MAX(sa.completed_at) as last_attempted
      FROM candidate_skills cs
      LEFT JOIN skill_assessments sa ON cs.id = sa.skill_id AND sa.completed_at IS NOT NULL
      WHERE cs.user_id = $1
      GROUP BY cs.id
      ORDER BY cs.is_verified ASC, cs.created_at DESC
    `,
		[userId],
	);

	const userSkillMap = {};
	for (const skill of userSkillsResult.rows) {
		userSkillMap[skill.skill_name.toLowerCase()] = skill;
	}

	// Build catalog with user's data overlaid
	const catalog = SKILL_CATALOG.map((catalogSkill) => {
		const userSkill = userSkillMap[catalogSkill.name.toLowerCase()];
		return {
			catalog_name: catalogSkill.name,
			category: catalogSkill.category,
			icon: catalogSkill.icon,
			description: catalogSkill.description,
			difficulty: catalogSkill.difficulty,
			// User-specific data
			skill_id: userSkill ? userSkill.id : null,
			is_verified: userSkill ? userSkill.is_verified : false,
			verified_score: userSkill ? userSkill.verified_score : null,
			assessment_count: userSkill ? parseInt(userSkill.assessment_count, 10) : 0,
			best_score: userSkill ? userSkill.best_score : null,
			last_attempted: userSkill ? userSkill.last_attempted : null,
			can_retake: canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, userSkill?.last_attempted),
		};
	});

	// Also include any user skills NOT in the catalog
	for (const skill of userSkillsResult.rows) {
		const inCatalog = SKILL_CATALOG.some(
			(c) => c.name.toLowerCase() === skill.skill_name.toLowerCase(),
		);
		if (!inCatalog) {
			catalog.push({
				catalog_name: skill.skill_name,
				category: skill.category,
				icon: skill.skill_name.substring(0, 2).toUpperCase(),
				description: `Custom skill: ${skill.skill_name}`,
				difficulty: 'Adaptive',
				skill_id: skill.id,
				is_verified: skill.is_verified,
				verified_score: skill.verified_score,
				assessment_count: parseInt(skill.assessment_count, 10),
				best_score: skill.best_score,
				last_attempted: skill.last_attempted,
				can_retake: canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, skill.last_attempted),
			});
		}
	}

	return catalog;
}

// Table path for GET /available (#1653, §4.4): the EXACT frozen response
// shape, assembled from the C0 tables. Catalogue order is
// subjects.sort_order; a subject's user skill is matched case-insensitively
// (LOWER = LOWER semantics) through its default topic's legacy_skill_name
// (so HTML/CSS finds the legacy "CSS & HTML" skill), falling back to the
// subject's own name. can_retake reads the last COMPLETED attempt
// (last_completed_at) — the same input the POST /start gate reads (§2.3).
function buildAvailableFromTables({ subjects, topics, progress }) {
	const progressBySkillName = new Map();
	for (const row of progress) {
		progressBySkillName.set(String(row.skill_name).toLowerCase(), row);
	}
	const defaultTopicBySubject = new Map();
	for (const topic of topics) {
		if (topic.legacy_skill_name && !defaultTopicBySubject.has(topic.subject_id)) {
			defaultTopicBySubject.set(topic.subject_id, topic);
		}
	}

	const matchedSkillNames = new Set();
	const catalog = subjects.map((subject) => {
		const defaultTopic = defaultTopicBySubject.get(subject.id);
		const userSkill =
			(defaultTopic?.legacy_skill_name &&
				progressBySkillName.get(defaultTopic.legacy_skill_name.toLowerCase())) ||
			progressBySkillName.get(subject.name.toLowerCase()) ||
			null;
		if (userSkill) matchedSkillNames.add(String(userSkill.skill_name).toLowerCase());
		return {
			catalog_name: subject.name,
			category: subject.category,
			icon: subject.icon,
			description: subject.description,
			difficulty: 'Adaptive',
			// User-specific data
			skill_id: userSkill ? userSkill.skill_id : null,
			is_verified: userSkill ? userSkill.is_verified : false,
			verified_score: userSkill ? userSkill.verified_score : null,
			assessment_count: userSkill ? parseInt(userSkill.assessment_count, 10) || 0 : 0,
			best_score: userSkill ? userSkill.best_score : null,
			last_attempted: userSkill ? userSkill.last_completed_at : null,
			can_retake: canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, userSkill?.last_completed_at),
		};
	});

	// Also include any user skills NOT in the catalogue (same append
	// semantics as the constant path).
	for (const row of progress) {
		if (matchedSkillNames.has(String(row.skill_name).toLowerCase())) continue;
		catalog.push({
			catalog_name: row.skill_name,
			category: row.category,
			icon: String(row.skill_name).substring(0, 2).toUpperCase(),
			description: `Custom skill: ${row.skill_name}`,
			difficulty: 'Adaptive',
			skill_id: row.skill_id,
			is_verified: row.is_verified,
			verified_score: row.verified_score,
			assessment_count: parseInt(row.assessment_count, 10) || 0,
			best_score: row.best_score,
			last_attempted: row.last_completed_at,
			can_retake: canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, row.last_completed_at),
		});
	}

	return catalog;
}

router.get('/available', authMiddleware, async (req, res) => {
	try {
		const tables = await loadCatalogTables(req.user.id);
		// Dual-read (R5, §6 step 3): the constant serves ONLY when the
		// subjects query returned zero rows. A thrown DB error lands in
		// the catch below as the generic 500 — never a confident
		// catalogue over a broken database.
		if (tables.subjects.length === 0) {
			return res.json({ skills: await buildAvailableFromConstant(req.user.id) });
		}
		res.json({ skills: buildAvailableFromTables(tables) });
	} catch (error) {
		console.error('Error fetching available assessments:', error);
		res.status(500).json({ error: 'Failed to fetch assessments' });
	}
});

// Catalogue as data (#1653, §4.1): subjects → topics with real approved-
// only availability (§7) and per-user progress. Responses are built from
// explicit field allowlists — DB rows are never spread (R4) — and carry
// counts only, never question content. Active topics with zero
// availability are included with available:false; inactive topics are
// excluded; topic-less active subjects return topics: [] (R2). Interim
// state (R3/R6): availability describes the bank per §7, but /start
// serving stays legacy until C2 — this endpoint does not change what a
// start draws from.
router.get('/catalog', authMiddleware, async (req, res) => {
	try {
		const { subjects, topics, counts, progress, topicProgress } = await loadCatalogTables(req.user.id);

		const countsByTopic = new Map();
		for (const row of counts) {
			if (!countsByTopic.has(row.topic_id)) countsByTopic.set(row.topic_id, []);
			countsByTopic.get(row.topic_id).push(row);
		}
		const progressBySkillName = new Map();
		for (const row of progress) {
			progressBySkillName.set(String(row.skill_name).toLowerCase(), row);
		}
		const topicProgressById = new Map();
		for (const row of topicProgress || []) {
			if (Number.isInteger(row.topic_id)) topicProgressById.set(row.topic_id, row);
		}
		const topicsBySubject = new Map();
		for (const topic of topics) {
			if (!topicsBySubject.has(topic.subject_id)) topicsBySubject.set(topic.subject_id, []);
			topicsBySubject.get(topic.subject_id).push(topic);
		}

		res.json({
			subjects: subjects.map((subject) => ({
				id: subject.id,
				slug: subject.slug,
				name: subject.name,
				category: subject.category,
				icon: subject.icon,
				description: subject.description,
				topics: (topicsBySubject.get(subject.id) || []).map((topic) => {
					// Progress (§3.7, #1656 R4): the per-(user, topic) read
					// model wins whenever this topic has completed attempts
					// of its own. Otherwise a default topic keeps the C1
					// skill-keyed surfacing through its legacy_skill_name
					// (topic-less legacy history aggregates at subject
					// level) — unchanged values, plus canRetake computed
					// from the last COMPLETED attempt, the /start gate's
					// own input (§4.4). No completed attempts anywhere →
					// null, never a fabricated number.
					let topicProgress = null;
					const topicRow = topicProgressById.get(topic.id);
					if (topicRow) {
						topicProgress = {
							attempts: parseInt(topicRow.attempts, 10),
							bestScore: topicRow.best_score,
							lastScore: topicRow.last_score,
							lastAttempted: topicRow.last_completed_at,
							canRetake: canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, topicRow.last_completed_at),
						};
					} else if (topic.legacy_skill_name) {
						const row = progressBySkillName.get(topic.legacy_skill_name.toLowerCase());
						if (row && parseInt(row.assessment_count, 10) > 0) {
							topicProgress = {
								attempts: parseInt(row.assessment_count, 10),
								bestScore: row.best_score,
								lastScore: row.last_score,
								lastAttempted: row.last_completed_at,
								canRetake: canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, row.last_completed_at),
							};
						}
					}
					return {
						id: topic.id,
						slug: topic.slug,
						name: topic.name,
						description: topic.description,
						availability: computeTopicAvailability(countsByTopic.get(topic.id) || []),
						progress: topicProgress,
					};
				}),
			})),
		});
	} catch (error) {
		console.error('Error fetching assessment catalog:', error);
		res.status(500).json({ error: 'Failed to fetch catalog' });
	}
});

// Pre-flight for one configuration (#1654, §4.1): what /start will
// actually serve for this topic + format + band, from real approved-only
// per-topic counts. largestAvailable is PER-CONFIGURATION (it equals
// servable for the asked configuration) — never the cross-configuration
// maxCount the catalogue reports. The instructions screen renders this
// verbatim; /start re-checks inside its transaction (this is advisory).
router.get('/catalog/:topicId/availability', authMiddleware, async (req, res) => {
	try {
		const topicId = parseInt(req.params.topicId, 10);
		const { format, band, count } = req.query;
		if (!Number.isInteger(topicId)) {
			return res.status(400).json({ error: 'Invalid topic id', code: 'INVALID_TOPIC' });
		}
		if (!CONFIG_FORMATS.includes(format)) {
			return res.status(400).json({ error: 'Invalid format', code: 'INVALID_FORMAT' });
		}
		if (!Object.hasOwn(BANDS, band)) {
			return res.status(400).json({ error: 'Invalid difficulty band', code: 'INVALID_BAND' });
		}
		let promised = null;
		if (count !== undefined) {
			promised = parseInt(count, 10);
			if (!Number.isInteger(promised) || promised <= 0) {
				return res.status(400).json({ error: 'Invalid count', code: 'INVALID_COUNT' });
			}
		}
		const topic = await findTopicById(pool, topicId);
		if (!topic || topic.is_active === false) {
			return res.status(404).json({ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' });
		}
		if (format === 'coding' && !assessmentsCodingEnabled()) {
			return res.json({
				promised,
				servable: 0,
				largestAvailable: 0,
				reason: 'Coding assessments are not available yet.',
			});
		}
		const servable = await topicServable(pool, topicId, format, band);
		let reason = null;
		if (servable === 0) {
			reason = 'No approved questions are available for this topic, format and difficulty yet.';
		} else if (promised != null && servable < promised) {
			reason = `Only ${servable} approved questions are available for this configuration right now.`;
		}
		return res.json({ promised, servable, largestAvailable: servable, reason });
	} catch (error) {
		console.error('Error fetching topic availability:', error);
		res.status(500).json({ error: 'Failed to fetch availability' });
	}
});

// Get past assessment results
router.get('/results', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;

		const result = await pool.query(
			`
      SELECT sa.*, cs.skill_name, cs.category,
             ass.tab_switches, ass.copy_paste_attempts, ass.time_anomalies,
             ass.max_difficulty_reached, ass.answers_given
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL
      ORDER BY sa.completed_at DESC
    `,
			[userId],
		);

		res.json({ results: result.rows });
	} catch (error) {
		console.error('Error fetching assessment results:', error);
		res.status(500).json({ error: 'Failed to fetch results' });
	}
});

// Candidate: job assessments currently assigned to me (status 'assigned').
// Powers the "Assigned to you" section — without this, candidates only learn
// about assignments from the notification, which previously had no link.
router.get('/assigned', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT jaa.id AS attempt_id, jaa.assessment_id, jaa.application_id, jaa.status,
              jaa.created_at, ja.title AS assessment_title, ja.job_id, j.title AS job_title
       FROM job_assessment_attempts jaa
       JOIN job_assessments ja ON ja.id = jaa.assessment_id
       JOIN jobs j ON j.id = ja.job_id
       WHERE jaa.candidate_id = $1 AND jaa.status = 'assigned'
       ORDER BY jaa.created_at DESC`,
			[req.user.id],
		);

		res.json({ attempts: result.rows });
	} catch (error) {
		console.error('Error fetching assigned assessments:', error);
		res.status(500).json({ error: 'Failed to fetch assigned assessments' });
	}
});

// Candidate: get my own attempt's score (transparency — candidates see their results).
// Only returns composite_score and pass/fail; never correct_answer/rubric.
router.get('/attempt/:attemptId/score', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT jaa.composite_score, jaa.status, jaa.scored_at, jaa.completion_flags,
              ja.passing_score
       FROM job_assessment_attempts jaa
       JOIN job_assessments ja ON ja.id = jaa.assessment_id
       WHERE jaa.id = $1 AND jaa.candidate_id = $2`,
			[req.params.attemptId, req.user.id],
		);
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Attempt not found' });
		}
		const row = result.rows[0];
		const sFlags = parseJsonObject(row.completion_flags);
		const sPartial = sFlags.partial === true;
		const passed =
			row.composite_score != null && row.composite_score >= (row.passing_score ?? 70);
		// Fix round F4: a completed partial attempt with zero answers is
		// terminal and will never be scored (scoreAttempt records the
		// unscored state and returns) — say so explicitly so the
		// candidate's pollScore stops instead of burning every retry.
		const unscored =
			row.status === 'completed' &&
			!row.scored_at &&
			sPartial &&
			(sFlags.answers_given ?? null) === 0;
		res.json({
			composite_score: row.composite_score,
			status: row.status,
			scored: !!row.scored_at,
			unscored,
			// Phase B: a partial submission is neither a pass nor a fail —
			// result stays null and the partial label carries the counts.
			result: sPartial ? null : row.composite_score != null ? (passed ? 'pass' : 'fail') : null,
			partial: sPartial,
			answersGiven: sFlags.answers_given ?? null,
			totalQuestions: sFlags.total_questions ?? null,
			autoSubmittedFullscreen: sFlags.fullscreen_auto_submit === true,
		});
	} catch (error) {
		console.error('Error fetching attempt score:', error);
		res.status(500).json({ error: 'Failed to fetch score' });
	}
});

// Start new assessment - accepts skillName+category OR skillId (AI RATE LIMITED)
router.post('/start', authMiddleware, rateLimits.ai, async (req, res) => {
	const client = await pool.connect();
	let clientReleased = false;
	try {
		const userId = req.user.id;
		const body = req.body || {};
		const { skillId, skillName, category, jobId } = body;
		// #1654 (C2): two start bodies. The configured body names a topic
		// and a configuration; the legacy body names a skill. Both end in
		// the SAME §3.6 snapshot — the legacy body via the recorded
		// defaults (§4.2/§8) — so downstream has one code path.
		const isConfigured = body.topicId !== undefined && body.topicId !== null;

		await client.query('BEGIN');

		let skill;
		let snapshot;
		let servable = null;

		if (isConfigured) {
			const topicId = parseInt(body.topicId, 10);
			const { format, difficultyBand } = body;
			if (!Number.isInteger(topicId)) {
				await client.query('ROLLBACK');
				return res.status(400).json({ error: 'Invalid topic id', code: 'INVALID_TOPIC' });
			}
			if (!CONFIG_FORMATS.includes(format)) {
				await client.query('ROLLBACK');
				return res.status(400).json({ error: 'Invalid format', code: 'INVALID_FORMAT' });
			}
			if (!Object.hasOwn(BANDS, difficultyBand)) {
				await client.query('ROLLBACK');
				return res.status(400).json({ error: 'Invalid difficulty band', code: 'INVALID_BAND' });
			}
			const topic = await findTopicById(client, topicId);
			if (!topic || topic.is_active === false) {
				await client.query('ROLLBACK');
				return res.status(404).json({ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' });
			}
			// §3.6: the candidate_skills row is resolved by the SUBJECT's
			// legacy skill name (via its default topic), through the same
			// lookup-or-create the legacy path has always run — history,
			// Verified and OmniScore keep aggregating at skill level.
			const defaultTopic = topic.legacy_skill_name
				? topic
				: await findDefaultTopicForSubject(client, topic.subject_id);
			if (!defaultTopic?.legacy_skill_name) {
				await client.query('ROLLBACK');
				return res.status(400).json({
					error: 'This topic is not available for assessment yet',
					code: 'TOPIC_NOT_AVAILABLE',
				});
			}
			skill = await resolveCandidateSkill(client, userId, {
				skillName: defaultTopic.legacy_skill_name,
				category,
			});
			if (!skill) {
				await client.query('ROLLBACK');
				return res.status(400).json({ error: 'Skill name or ID required' });
			}
			// STOP 1 Q4: coding while ASSESSMENTS_CODING_ENABLED is OFF is
			// the honest 503 family with a format-specific reason — never
			// a silent substitution to another format.
			if (format === 'coding' && !assessmentsCodingEnabled()) {
				await client.query('ROLLBACK');
				return res.status(503).json({
					error: 'Coding assessments are not available yet.',
					code: 'QUESTION_UNAVAILABLE',
					retryable: false,
					reason: 'coding_disabled',
					format: 'coding',
				});
			}
			// #1656 (C3, R1/R2): set resolution. An explicit setId must
			// exist and be compatible (§4.6 via setMatchesSession) —
			// otherwise the honest 400 SETS_NOT_AVAILABLE, rolled back
			// BEFORE any session exists (the C2 contract, kept). No
			// setId + compatible active sets for this topic → auto-pick
			// the set gone longest without completion; no sets at all →
			// pool mode, exactly as C2.
			let resolvedSetId = null;
			if (body.setId !== undefined && body.setId !== null) {
				const setId = parseInt(body.setId, 10);
				const set = Number.isInteger(setId) ? await loadSetById(client, setId) : null;
				if (!setMatchesSession(set, topic.id, format, difficultyBand)) {
					await client.query('ROLLBACK');
					return res.status(400).json({
						error: 'Assessment set is not available for this topic and configuration',
						code: 'SETS_NOT_AVAILABLE',
					});
				}
				resolvedSetId = set.id;
			} else {
				const auto = await pickAutoSet(client, topic.id, userId, format, difficultyBand);
				if (auto) resolvedSetId = auto.id;
			}
			snapshot = {
				subjectId: topic.subject_id,
				topicId: topic.id,
				setId: resolvedSetId,
				format,
				difficultyBand,
				totalQuestions: body.totalQuestions,
			};
			// Availability is re-checked INSIDE the transaction (§4.1:
			// pre-flight is advisory; start is authoritative). For a set
			// session the promise is the SET's approved membership, not
			// the topic pool (R2) — the labelled-offer rule below then
			// keys off the set's own servable count.
			servable =
				resolvedSetId != null
					? await setApprovedCount(client, resolvedSetId)
					: await topicServable(client, topic.id, format, difficultyBand);
			// STOP 1 Q1: the enum governs the choice UI; a non-enum count
			// is accepted ONLY when it is exactly this configuration's
			// current servable — the labelled largestAvailable offer the
			// candidate explicitly accepted.
			const tq = snapshot.totalQuestions;
			const isEnumCount = CONFIG_COUNTS.includes(tq);
			const isLabelledOffer = Number.isInteger(tq) && tq > 0 && tq === servable;
			if (!isEnumCount && !isLabelledOffer) {
				await client.query('ROLLBACK');
				return res.status(400).json({
					error: 'Invalid total questions',
					code: 'INVALID_COUNT',
					largestAvailable: servable,
				});
			}
		} else {
			skill = await resolveCandidateSkill(client, userId, { skillId, skillName, category });
			if (!skill) {
				await client.query('ROLLBACK');
				return res.status(400).json({ error: 'Skill name or ID required' });
			}
			// §4.2/§8 recorded defaults: the skill's default topic (by its
			// legacy name), mixed / medium / 10, start difficulty 3 (band
			// centre — SF-9's deliberate change for NEW legacy starts;
			// in-flight NULL-config sessions are untouched). A skill with
			// no catalogue topic snapshots the defaults with a NULL topic
			// and serves via the legacy skill match, as today.
			const defaultTopic = await findDefaultTopicBySkillName(client, skill.skill_name);
			snapshot = {
				subjectId: defaultTopic?.subject_id ?? null,
				topicId: defaultTopic?.id ?? null,
				setId: null, // legacy body: pool mode, exactly as before C3
				format: 'mixed',
				difficultyBand: 'medium',
				totalQuestions: 10,
			};
		}

		// Retake lockout: a completed assessment inside the lockout window
		// blocks a new start (mirrors aptitude's RETAKE_LOCKOUT). Checked
		// before abandoning any in-progress session, same order as aptitude.
		const lastCompleted = await client.query(
			`SELECT completed_at FROM skill_assessments
       WHERE user_id = $1 AND skill_id = $2 AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
			[userId, skill.id],
		);
		if (
			lastCompleted.rows.length > 0 &&
			!canRetakeSkill(SKILL_RETAKE_LOCKOUT_DAYS, lastCompleted.rows[0].completed_at)
		) {
			await client.query('ROLLBACK');
			return res.status(403).json({
				error: 'Retake lockout active',
				code: 'RETAKE_LOCKOUT',
				lockoutDays: SKILL_RETAKE_LOCKOUT_DAYS,
				lastCompletedAt: lastCompleted.rows[0].completed_at,
			});
		}

		// Check for active session. #1687 (STOP 1 ruling): when the new
		// session's snapshot resolves a topic, the abandon is scoped to
		// in-progress sessions of the SAME topic and abandons ALL of them —
		// starting Topic B must never silently abandon a Topic A attempt on
		// the same skill. A start with no topic (NULL snapshot topic) keeps
		// the legacy skill-wide behaviour exactly (first match only).
		const hasTopic = snapshot.topicId != null;
		const activeSession = hasTopic
			? await client.query(
					"SELECT id FROM assessment_sessions WHERE user_id = $1 AND skill_id = $2 AND status = 'in_progress' AND topic_id = $3",
					[userId, skill.id, snapshot.topicId],
				)
			: await client.query(
					"SELECT id FROM assessment_sessions WHERE user_id = $1 AND skill_id = $2 AND status = 'in_progress'",
					[userId, skill.id],
				);
		const sessionsToAbandon = hasTopic ? activeSession.rows : activeSession.rows.slice(0, 1);
		for (const oldSession of sessionsToAbandon) {
			// Abandon old session
			await client.query("UPDATE assessment_sessions SET status = 'abandoned' WHERE id = $1", [
				oldSession.id,
			]);
		}

		// Create assessment session — with the §3.6 configuration snapshot
		// and the band's start difficulty (legacy-mapped starts take the
		// medium default: start 3, §8/SF-9).
		const startDifficulty = BAND_START[snapshot.difficultyBand];
		const sessionResult = await client.query(
			`
      INSERT INTO assessment_sessions
      (user_id, skill_id, job_id, status, current_difficulty, current_question_index, score,
       max_difficulty_reached, tab_switches, copy_paste_attempts, time_anomalies,
       questions_asked, answers_given, started_at,
       subject_id, topic_id, format, difficulty_band, total_questions, set_id)
      VALUES ($1, $2, $3, 'in_progress', $4, 0, 0, $4, 0, 0, 0, '[]'::jsonb, '[]'::jsonb, NOW(),
              $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
			[
				userId,
				skill.id,
				jobId || null,
				startDifficulty,
				snapshot.subjectId,
				snapshot.topicId,
				snapshot.format,
				snapshot.difficultyBand,
				snapshot.totalQuestions,
				snapshot.setId ?? null,
			],
		);

		const session = sessionResult.rows[0];

		// Phase A (#1606 FR-A7): the session commits BEFORE the first question
		// is served. A question-supply failure can no longer roll the session
		// back — the session stays in_progress and resumable, and /start
		// reports the honest question-unavailable state with its id.
		await client.query('COMMIT');
		client.release();
		clientReleased = true;

		// #1654 (§4.1): a configured start whose promised count exceeds the
		// supply re-checked above does not serve a first question — the
		// committed, resumable session is reported with the existing 503
		// shape EXTENDED by the promise and the honest largestAvailable,
		// so the client can offer the labelled smaller count (Q1).
		if (isConfigured && servable < snapshot.totalQuestions) {
			return res.status(503).json({
				error:
					'Not enough questions are available for this configuration yet. Your attempt has been saved — you can resume it, or choose the available count instead.',
				code: 'QUESTION_UNAVAILABLE',
				retryable: true,
				sessionId: session.id,
				skillName: skill.skill_name,
				promised: snapshot.totalQuestions,
				largestAvailable: servable,
			});
		}

		const served = await serveNextQuestion(session.id);
		if (!served.ok) {
			return res.status(503).json({
				error:
					'No questions are available for this assessment yet. Your attempt has been saved — please try again shortly.',
				code: 'QUESTION_UNAVAILABLE',
				retryable: true,
				sessionId: session.id,
				skillName: skill.skill_name,
			});
		}

		return res.json({
			sessionId: session.id,
			skillName: skill.skill_name,
			question: served.question,
		});
	} catch (error) {
		if (!clientReleased) await client.query('ROLLBACK').catch(() => {});
		console.error('Error starting assessment:', error);
		if (error.allProvidersFailed) {
			return handleAIError(res, error, 'Assessment generation');
		}
		res.status(500).json({ error: 'Failed to start assessment' });
	} finally {
		if (!clientReleased) client.release();
	}
});

// Submit answer. Phase A (#1602): recording the answer, evaluating it, and
// serving the next question are now separate steps with separate failure
// outcomes. Previously one transaction did all three, so a next-question
// generation failure rolled the candidate's just-recorded answer back, and
// the passing-leg completion could deadlock against the OmniScore write
// (#1612). The next question is served by GET /session/:sessionId/current
// (serveNextQuestion) — this route only records and, on the final answer,
// completes.
router.post('/answer', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const { sessionId, questionId, answer, timeTaken } = req.body;
		// Coerce once: JSONB-stored ids are numbers, and a string "5" must
		// not bypass the duplicate/outstanding comparisons below.
		const qid = Number(questionId);
		if (!Number.isInteger(qid)) {
			return res.status(400).json({ error: 'Invalid question id', code: 'INVALID_QUESTION' });
		}

		// Load session + question without holding a transaction: evaluation
		// below may take seconds (AI cascade) and must not hold DB locks.
		const sessionResult = await pool.query(
			'SELECT * FROM assessment_sessions WHERE id = $1 AND user_id = $2',
			[sessionId, userId],
		);

		if (sessionResult.rows.length === 0) {
			return res.status(404).json({ error: 'Session not found' });
		}

		const session = sessionResult.rows[0];

		if (session.status !== 'in_progress') {
			return res
				.status(400)
				.json({ error: 'This attempt is already finished', code: 'ALREADY_FINISHED' });
		}

		// Get question details
		const questionResult = await pool.query('SELECT * FROM assessment_questions WHERE id = $1', [
			qid,
		]);

		if (questionResult.rows.length === 0) {
			return res.status(404).json({ error: 'Question not found' });
		}

		const question = questionResult.rows[0];

		// Idempotency: a retried submission of an already-recorded answer
		// (client timeout, double-click, timer + manual press) returns the
		// recorded state — the answer is never recorded or scored twice.
		// The one exception is a RE-SERVED question: when the bank cell is
		// exhausted, serveNextQuestion may serve a question the session
		// answered earlier; as the currently-outstanding question it is a
		// NEW answer, not a retry. (Without this distinction the retry
		// guard and the re-serve together trap the candidate on one
		// question forever.)
		if (isAlreadyRecorded(session, qid)) {
			return await respondAfterRecord(res, sessionId, userId, {
				feedback: 'Answer already recorded',
				explanation: question.explanation,
			});
		}

		// Integrity: only the session's outstanding question can be
		// answered. Anything else — a question never served in this
		// attempt, or an old one that is not outstanding — is rejected, so
		// this endpoint can neither skip the adaptive sequence nor act as
		// a per-id answer oracle for the bank (review finding, PR #1620).
		if (qid !== outstandingQuestionId(session)) {
			return res.status(400).json({
				error: 'That question is not the current question in this attempt',
				code: 'QUESTION_NOT_CURRENT',
			});
		}

		// Evaluate answer
		let isCorrect = false;
		let scorePoints = 0;
		let aiFeedback = null;
		// #1572: short-answer evaluation outcome. evaluationScore stays null
		// and evaluationStatus 'pending_manual_review' when no evaluation
		// happened — the answer is recorded, never scored by default.
		let evaluationScore = null;
		let evaluationStatus = null;

		if (question.question_type === 'multiple_choice') {
			isCorrect = answer === question.correct_answer;
			scorePoints = isCorrect ? (question.difficulty_level || 2) * 10 : 0;
		} else if (question.question_type === 'short_answer') {
			// Use AI to evaluate short answer
			const evaluation = await evaluateShortAnswer(
				question.question_text,
				answer,
				question.explanation,
			);
			if (evaluation) {
				evaluationScore = evaluation.score;
				evaluationStatus = 'evaluated';
				isCorrect = evaluation.score >= 70;
				scorePoints = Math.round((evaluation.score / 100) * (question.difficulty_level || 2) * 15);
				aiFeedback = evaluation.feedback;

				// Log AI explanation generation for compliance
				await AuditLogger.log({
					actionType: 'ai_explanation_generated',
					userId: userId,
					targetType: 'assessment_question',
					targetId: qid,
					metadata: {
						session_id: sessionId,
						question_type: 'short_answer',
						ai_score: evaluation.score,
						model_version: 'adaptive-assessment-v1',
						confidence: evaluation.score / 100,
						explanation_type: 'answer_evaluation',
					},
					req: null,
				});
			} else {
				// #1572: no evaluation happened — record the answer as
				// unevaluated: no score, no points, not correct or incorrect,
				// and NO ai_score/confidence in the audit trail. The failure
				// itself is logged explicitly instead.
				evaluationStatus = 'pending_manual_review';
				isCorrect = null;
				aiFeedback =
					'Unable to evaluate automatically. Your answer has been recorded for manual review.';
				// NOTE: the event name deliberately does NOT start with
				// 'ai_'. The admin compliance readers (routes/admin.js)
				// sweep `action_type LIKE 'ai_%'` as AI *decisions* and
				// COALESCE a missing confidence to 0.85 — a failed
				// evaluation is not an AI decision and must not resurface
				// there with a fabricated confidence.
				await AuditLogger.log({
					actionType: 'assessment_evaluation_failed',
					userId: userId,
					targetType: 'assessment_question',
					targetId: qid,
					metadata: {
						session_id: sessionId,
						question_type: 'short_answer',
						evaluation_status: 'pending_manual_review',
						model_version: 'adaptive-assessment-v1',
						explanation_type: 'answer_evaluation',
					},
					req: null,
				});
			}
		}

		// Check for time anomaly (too fast)
		const expectedMinTime = question.question_type === 'multiple_choice' ? 5 : 15;
		const isTimeAnomaly = timeTaken < expectedMinTime;

		// #1572: unevaluated answers are "Pending manual review", never "Incorrect".
		const answerFeedback =
			evaluationStatus === 'pending_manual_review'
				? 'Pending manual review'
				: isCorrect
					? 'Correct!'
					: 'Incorrect';

		// Record the answer in its OWN transaction and COMMIT it before
		// anything else happens. The session row lock serialises concurrent
		// submissions for this session; the duplicate re-check under the lock
		// makes a racing retry a no-op. From the COMMIT on, the answer cannot
		// be lost by any later failure (FR-A1).
		const client = await pool.connect();
		let alreadyFinished = false;
		let alreadyRecorded = false;
		let questionRejected = false;
		try {
			await client.query('BEGIN');
			const lockedResult = await client.query(
				'SELECT * FROM assessment_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
				[sessionId, userId],
			);
			const locked = lockedResult.rows[0];
			if (!locked || locked.status !== 'in_progress') {
				await client.query('ROLLBACK');
				alreadyFinished = true;
			} else if (!isAlreadyRecorded(locked, qid) && qid !== outstandingQuestionId(locked)) {
				// Re-validated under the lock: the outstanding question moved
				// (a racing submission recorded first) or this question was
				// never this attempt's to answer.
				await client.query('ROLLBACK');
				questionRejected = true;
			} else {
				const answersGiven = parseJsonArray(locked.answers_given);
				if (isAlreadyRecorded(locked, qid)) {
					await client.query('COMMIT');
					alreadyRecorded = true;
				} else {
					answersGiven.push({
						questionId: qid,
						answer,
						isCorrect,
						scorePoints,
						score: evaluationScore,
						evaluationStatus,
						timeTaken,
						timestamp: new Date(),
						aiFeedback,
					});

					const newScore = (locked.score || 0) + scorePoints;

					// Adaptive difficulty: increase if correct and no time anomaly, decrease if wrong.
					// #1572: an unevaluated answer (isCorrect null) moves difficulty NEITHER
					// way — the candidate is not penalised for an evaluation failure.
					// #1654 (§5.2): the step is clamped to the locked session's
					// band (easy [1,2] / medium [2,4] / hard [4,5]); a NULL band
					// (in-flight legacy session, §8) keeps the unbounded [1,5].
					let newDifficulty = locked.current_difficulty || 2;
					if (isCorrect === true && !isTimeAnomaly) {
						newDifficulty += 1;
					} else if (isCorrect === false) {
						newDifficulty -= 1;
					}
					newDifficulty = clampToBand(newDifficulty, locked.difficulty_band);

					const maxDifficultyReached = Math.max(locked.max_difficulty_reached || 2, newDifficulty);
					const timeAnomalies = (locked.time_anomalies || 0) + (isTimeAnomaly ? 1 : 0);

					await client.query(
						`
      UPDATE assessment_sessions
      SET answers_given = $1, score = $2, current_question_index = $3,
          current_difficulty = $4, max_difficulty_reached = $5,
          time_anomalies = $6,
          current_draft = CASE WHEN current_draft->>'questionId' = $8 THEN NULL ELSE current_draft END
      WHERE id = $7
    `,
						[
							JSON.stringify(answersGiven),
							newScore,
							// current_question_index = answers recorded so far.
							// (Pre-Phase-A this was seeded to 1 at start and then
							// incremented, so an attempt "completed" after 9
							// answers while its questions were numbered 1,3,4… —
							// counts are real now: question N is answers+1.)
							answersGiven.length,
							newDifficulty,
							maxDifficultyReached,
							timeAnomalies,
							sessionId,
							// Phase B (§8.2): recording the drafted question's
							// answer clears the stored draft in the same write.
							String(qid),
						],
					);
					await client.query('COMMIT');
				}
			}
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}

		if (alreadyFinished) {
			return res
				.status(400)
				.json({ error: 'This attempt is already finished', code: 'ALREADY_FINISHED' });
		}
		if (questionRejected) {
			return res.status(400).json({
				error: 'That question is not the current question in this attempt',
				code: 'QUESTION_NOT_CURRENT',
			});
		}
		if (alreadyRecorded) {
			return await respondAfterRecord(res, sessionId, userId, {
				feedback: 'Answer already recorded',
				explanation: question.explanation,
			});
		}
		return await respondAfterRecord(res, sessionId, userId, {
			feedback: answerFeedback,
			explanation: question.explanation,
			aiFeedback,
		});
	} catch (error) {
		console.error('Error submitting answer:', error);
		if (error.allProvidersFailed) {
			return handleAIError(res, error, 'Answer evaluation');
		}
		res.status(500).json({ error: 'Failed to submit answer' });
	}
});

// Log anti-cheat event
router.post('/event', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const { sessionId, eventType, eventData } = req.body;

		// Verify session belongs to user
		const sessionResult = await pool.query(
			'SELECT id FROM assessment_sessions WHERE id = $1 AND user_id = $2',
			[sessionId, userId],
		);

		if (sessionResult.rows.length === 0) {
			return res.status(404).json({ error: 'Session not found' });
		}

		// Log event
		await pool.query(
			`
      INSERT INTO assessment_events (session_id, event_type, event_data)
      VALUES ($1, $2, $3)
    `,
			[sessionId, eventType, JSON.stringify(eventData || {})],
		);

		// Update session counters
		if (eventType === 'tab_switch') {
			await pool.query(
				'UPDATE assessment_sessions SET tab_switches = COALESCE(tab_switches, 0) + 1 WHERE id = $1',
				[sessionId],
			);
		} else if (eventType === 'copy_paste') {
			await pool.query(
				'UPDATE assessment_sessions SET copy_paste_attempts = COALESCE(copy_paste_attempts, 0) + 1 WHERE id = $1',
				[sessionId],
			);
		}

		res.json({ logged: true });
	} catch (error) {
		console.error('Error logging event:', error);
		res.status(500).json({ error: 'Failed to log event' });
	}
});

// Phase B (#1604/#1605, design §3.3): the unified exit endpoint — the one
// server transition behind the Exit dialog's Save & Exit / Submit & Exit /
// Exit Exam outcomes (Continue Test is client-only: no server state). All
// terminal transitions are the atomic claims of §4.3; a second terminal
// action on a finished attempt is 409 ALREADY_FINISHED, so any exit
// request can be retried blindly and safely (§6.1).
router.post('/session/:sessionId/exit', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const sessionId = req.params.sessionId;
		const { action, draft, reason } = req.body || {};
		if (!['save', 'submit', 'abandon'].includes(action)) {
			return res.status(400).json({ error: 'Invalid exit action', code: 'INVALID_ACTION' });
		}
		const exitReason = reason === 'fullscreen_second_exit' ? 'fullscreen_second_exit' : 'candidate';

		const sessionResult = await pool.query(
			'SELECT * FROM assessment_sessions WHERE id = $1 AND user_id = $2',
			[sessionId, userId],
		);
		if (sessionResult.rows.length === 0) {
			return res.status(404).json({ error: 'Session not found' });
		}
		const session = sessionResult.rows[0];
		if (session.status !== 'in_progress') {
			return res.status(409).json({
				error: 'This attempt is already finished',
				code: 'ALREADY_FINISHED',
				status: session.status,
			});
		}
		const answersGiven = parseJsonArray(session.answers_given).length;

		if (action === 'save') {
			// The draft is stored-but-not-answered (§8.2): it must belong to
			// the session's currently-outstanding question — anything else
			// is not this attempt's current work.
			let storedDraft = null;
			if (draft != null) {
				const qid = Number(draft.questionId);
				if (!Number.isInteger(qid) || typeof draft.answer !== 'string') {
					return res.status(400).json({ error: 'Invalid draft', code: 'INVALID_DRAFT' });
				}
				if (qid !== outstandingQuestionId(session)) {
					return res.status(400).json({
						error: 'That question is not the current question in this attempt',
						code: 'QUESTION_NOT_CURRENT',
					});
				}
				storedDraft = { questionId: qid, answer: draft.answer, savedAt: new Date().toISOString() };
			}
			// Fix round F5: the draft write is a CLAIM, not a blind write —
			// ownership + status are in the UPDATE itself, its rowcount is
			// checked, and the exit_save event is written in the SAME
			// transaction only when the claim won. A save that loses a race
			// to a terminal claim gets 409, never a false 200/event.
			const saveClient = await pool.connect();
			try {
				await saveClient.query('BEGIN');
				const claim = await saveClient.query(
					'UPDATE assessment_sessions SET current_draft = $1 WHERE id = $2 AND user_id = $3 AND status = $4',
					[storedDraft ? JSON.stringify(storedDraft) : null, sessionId, userId, 'in_progress'],
				);
				if (claim.rowCount === 0) {
					await saveClient.query('ROLLBACK');
					const now = await pool.query('SELECT status FROM assessment_sessions WHERE id = $1', [
						sessionId,
					]);
					return res.status(409).json({
						error: 'This attempt is already finished',
						code: 'ALREADY_FINISHED',
						status: now.rows[0]?.status,
					});
				}
				await saveClient.query(
					`INSERT INTO assessment_events (session_id, event_type, event_data) VALUES ($1, 'exit_save', $2)`,
					[sessionId, JSON.stringify({ answersGiven })],
				);
				await saveClient.query('COMMIT');
			} catch (saveErr) {
				await saveClient.query('ROLLBACK').catch(() => {});
				throw saveErr;
			} finally {
				saveClient.release();
			}
			return res.json({ status: 'in_progress', answersGiven, totalQuestions: sessionTotal(session) });
		}

		if (action === 'submit') {
			// Saved answers only — a supplied draft is NOT submitted (the
			// dialog says so; §6.1). The claim is the existing Phase A
			// atomic completion, with the Phase B reason attached.
			const completion = await completeAssessmentTx(sessionId, userId, { reason: exitReason });
			if (!completion) {
				// The claim lost to a non-completion terminal transition
				// (e.g. a racing abandon) — report the real end state.
				const now = await pool.query('SELECT status FROM assessment_sessions WHERE id = $1', [sessionId]);
				return res.status(409).json({
					error: 'This attempt is already finished',
					code: 'ALREADY_FINISHED',
					status: now.rows[0]?.status,
				});
			}
			if (completion.alreadyCompleted) {
				// Fix round F6: a racing Submit & Exit already completed
				// this attempt — the loser gets the documented 409
				// ALREADY_FINISHED (design §4.3), not the winner's 200.
				// Exactly-once still holds: completeAssessmentTx skipped
				// every side effect for the alreadyCompleted claim.
				return res.status(409).json({
					error: 'This attempt is already finished',
					code: 'ALREADY_FINISHED',
					status: 'completed',
				});
			}
			await pool.query(
				`INSERT INTO assessment_events (session_id, event_type, event_data) VALUES ($1, 'exit_submit', $2)`,
				[
					sessionId,
					JSON.stringify({
						answersGiven: completion.answersGiven ?? answersGiven,
						reason: exitReason,
						partial: completion.partial === true,
					}),
				],
			).catch(() => {});
			return res.json({
				status: 'completed',
				answersGiven: completion.answersGiven ?? answersGiven,
				totalQuestions: completion.totalQuestions ?? sessionTotal(session),
				format: session.format ?? null,
				difficultyBand: session.difficulty_band ?? null,
				partial: completion.partial === true,
				score: completion.score ?? null,
				passed: completion.passed === true,
				correctCount: completion.correctCount ?? null,
				fullscreenAutoSubmit: completion.fullscreenAutoSubmit === true,
				...(draft != null ? { draftExcluded: true } : {}),
			});
		}

		// action === 'abandon' — Exit Exam.
		const abandon = await abandonSessionTx(sessionId, userId, exitReason);
		if (!abandon) return res.status(500).json({ error: 'Failed to exit assessment' });
		if (abandon.notFound) return res.status(404).json({ error: 'Session not found' });
		if (abandon.already) {
			return res.status(409).json({
				error: 'This attempt is already finished',
				code: 'ALREADY_FINISHED',
				status: abandon.status,
			});
		}
		return res.json({
			status: 'abandoned',
			answersGiven: abandon.answersGiven,
			totalQuestions: sessionTotal(session),
		});
	} catch (error) {
		console.error('Error processing assessment exit:', error);
		res.status(500).json({ error: 'Failed to exit assessment' });
	}
});

// The legacy promised count: in-flight sessions with a NULL snapshot
// read as 10 (§8). Configured sessions carry their own total_questions —
// sessionTotal() is the only reader; never compare against this directly.
const LEGACY_TOTAL_QUESTIONS = 10;

// The session's currently-outstanding question id (asked but not yet
// answered), or null when no question is outstanding.
function outstandingQuestionId(session) {
	const questionsAsked = parseJsonArray(session.questions_asked);
	const answersGiven = parseJsonArray(session.answers_given);
	return questionsAsked.length > answersGiven.length
		? questionsAsked[questionsAsked.length - 1].questionId
		: null;
}

// True when questionId was already recorded AND is not the session's
// currently-outstanding question (asked but not yet answered). A re-served
// outstanding question is answerable again; any other already-answered
// question is a duplicate submission.
function isAlreadyRecorded(session, questionId) {
	const answersGiven = parseJsonArray(session.answers_given);
	return (
		outstandingQuestionId(session) !== questionId &&
		answersGiven.some((a) => a.questionId === questionId)
	);
}

function parseJsonArray(value) {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

function questionPayload(question, questionNumber, totalQuestions = LEGACY_TOTAL_QUESTIONS) {
	return {
		id: question.id,
		text: question.question_text,
		type: question.question_type,
		options: typeof question.options === 'string' ? JSON.parse(question.options) : question.options,
		timeLimit: question.time_limit_seconds || 120,
		questionNumber,
		totalQuestions,
	};
}

// Phase A (#1602 FR-A5 / #1606 FR-A7): serve the session's next question as a
// NAVIGATION step, fully separate from answer recording. If a question is
// already outstanding (asked but unanswered) it is re-served — that is what
// makes refresh, start-retry and answer-retry all converge on this one path.
// The session row lock serialises concurrent serves for the same session.
// Returns { ok: true, question } or { ok: false, reason } — a generation
// failure is a retryable navigation outcome here, never an answer loss.
async function serveNextQuestion(sessionId) {
	let client;
	try {
		client = await pool.connect();
		await client.query('BEGIN');
		const sessionResult = await client.query(
			'SELECT * FROM assessment_sessions WHERE id = $1 FOR UPDATE',
			[sessionId],
		);
		if (sessionResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return { ok: false, reason: 'not_found' };
		}
		const session = sessionResult.rows[0];
		if (session.status !== 'in_progress') {
			await client.query('ROLLBACK');
			return { ok: false, reason: 'finished', status: session.status };
		}
		const questionsAsked = parseJsonArray(session.questions_asked);
		const answersGiven = parseJsonArray(session.answers_given);

		if (questionsAsked.length > answersGiven.length) {
			const outstanding = await client.query('SELECT * FROM assessment_questions WHERE id = $1', [
				questionsAsked[questionsAsked.length - 1].questionId,
			]);
			await client.query('COMMIT');
			if (outstanding.rows.length === 0) return { ok: false, reason: 'question_missing' };
			return {
				ok: true,
				question: questionPayload(outstanding.rows[0], answersGiven.length + 1, sessionTotal(session)),
			};
		}

		if (answersGiven.length >= sessionTotal(session)) {
			await client.query('ROLLBACK');
			return { ok: false, reason: 'awaiting_completion' };
		}

		// #1656 (C3, §3.3/R2): set mode — serve the set's own questions in
		// position order. The set is the whole supply: when its servable
		// questions are exhausted before the promised count (a member
		// lost approval mid-session), serving stops with the same
		// awaiting_completion outcome pool mode uses at its total, and
		// the callers complete the attempt honestly as a partial. There
		// is NEVER a silent pool fallback mid-set.
		if (session.set_id != null) {
			const setIds = await loadSetQuestionIds(client, session.set_id);
			const nextIdx = answersGiven.length;
			if (nextIdx >= setIds.length) {
				await client.query('ROLLBACK');
				return { ok: false, reason: 'awaiting_completion' };
			}
			const setQuestion = await client.query('SELECT * FROM assessment_questions WHERE id = $1', [
				setIds[nextIdx],
			]);
			if (setQuestion.rows.length === 0) {
				await client.query('ROLLBACK');
				return { ok: false, reason: 'question_missing' };
			}
			const question = setQuestion.rows[0];
			questionsAsked.push({
				questionId: question.id,
				difficulty: question.difficulty_level,
				timestamp: new Date(),
			});
			await client.query(
				'UPDATE assessment_sessions SET questions_asked = $1, current_question_index = $2 WHERE id = $3',
				[JSON.stringify(questionsAsked), answersGiven.length + 1, sessionId],
			);
			await client.query('COMMIT');
			return {
				ok: true,
				question: questionPayload(question, answersGiven.length + 1, sessionTotal(session)),
			};
		}

		const skillResult = await client.query('SELECT * FROM candidate_skills WHERE id = $1', [
			session.skill_id,
		]);
		if (skillResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return { ok: false, reason: 'skill_missing' };
		}
		const skill = skillResult.rows[0];

		// #1656 (C3, R3/§5.3): the most recent COMPLETED attempt's asked
		// ids ride along as a SOFT exclusion — generateQuestion applies
		// them only while the pool can still meet the remaining count.
		const softExcludeIds = await loadPreviousCompletedQuestionIds(client, session);
		const question = await generateQuestion(
			skill.skill_name,
			skill.category,
			session.current_difficulty || 2,
			client,
			questionsAsked.map((q) => q.questionId),
			session,
			softExcludeIds,
		);
		if (!question) {
			await client.query('ROLLBACK');
			return { ok: false, reason: 'unavailable' };
		}

		questionsAsked.push({
			questionId: question.id,
			difficulty: question.difficulty_level,
			timestamp: new Date(),
		});
		await client.query(
			'UPDATE assessment_sessions SET questions_asked = $1, current_question_index = $2 WHERE id = $3',
			[JSON.stringify(questionsAsked), answersGiven.length + 1, sessionId],
		);
		await client.query('COMMIT');
		return {
			ok: true,
			question: questionPayload(question, answersGiven.length + 1, sessionTotal(session)),
		};
	} catch (error) {
		if (client) await client.query('ROLLBACK').catch(() => {});
		console.error('Error serving next question:', error);
		return { ok: false, reason: 'error' };
	} finally {
		if (client) client.release();
	}
}

// Phase A (#1602 FR-A3 / #1612): run completeAssessment in its OWN transaction
// so the terminal transition is atomic and independent of answer recording.
// Returns the completion result, or null when completion itself failed (the
// recorded answers are safe either way; the caller surfaces a retry state).
async function completeAssessmentTx(sessionId, userId, opts = {}) {
	let client;
	let result;
	try {
		client = await pool.connect();
		await client.query('BEGIN');
		result = await completeAssessment(client, sessionId, userId, opts);
		await client.query('COMMIT');
	} catch (error) {
		if (client) await client.query('ROLLBACK').catch(() => {});
		console.error('Error completing assessment:', error);
		return null;
	} finally {
		if (client) client.release();
	}
	// Phase B (database-reviewer condition): a full-screen auto-submit that
	// RETRIES after the original completion already landed must still mark
	// the attempt as auto-submitted — idempotent jsonb_set, post-commit,
	// never a second completion.
	if (result && result.alreadyCompleted && opts.reason === 'fullscreen_second_exit') {
		try {
			await pool.query(
				`UPDATE skill_assessments
				 SET behavioral_flags = jsonb_set(COALESCE(behavioral_flags, '{}'::jsonb), '{fullscreen_auto_submit}', 'true'::jsonb)
				 WHERE session_id = $1`,
				[sessionId],
			);
			result.fullscreenAutoSubmit = true;
		} catch (err) {
			console.error('[PhaseB] Failed to backfill fullscreen_auto_submit flag:', err.message);
		}
	}
	// completeAssessment returns null when the claim found no in_progress
	// session AND no existing completion (e.g. the session was abandoned
	// by a newer start in the meantime): nothing was completed, and no
	// side effect may fire for a completion that never happened.
	if (!result) return null;

	// #1612 Option B (see completeAssessment): post-commit side effects.
	// The completion itself is already durable; neither failure below may
	// change the outcome the candidate sees. Skipped entirely for an
	// alreadyCompleted claim (the original completion ran them).
	if (result && !result.alreadyCompleted && result.assessmentId) {
		// FOUNDER RULING (Phase B): a partial terminal submission does NOT
		// feed OmniScore. The graded audit below still records it — labelled
		// partial — because the grading did happen.
		if (!result.partial) {
			try {
				// Bounded: a hung feed must not hang the candidate's completed
				// response or the audit write below. On timeout the underlying
				// feed may still land late (harmless — it is the same single
				// write, never re-run); the failure is logged either way.
				await Promise.race([
					omniscoreService.addTechnicalComponent(
						userId,
						result.assessmentId,
						result.score || 0,
						100,
					),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error('OmniScore feed timed out after 20s')), 20000),
					),
				]);
				console.log(
					`[OmniScore] Assessment ${result.assessmentId} fed into OmniScore for user ${userId} (score: ${result.score})`,
				);
			} catch (err) {
				console.error(
					'[OmniScore] Failed to update from assessment (completion already committed):',
					err.message,
				);
			}
		}

		// Audit log: AI assessment graded. Written after the (bounded)
		// OmniScore attempt; AuditLogger never throws (it logs its own
		// failures).
		await AuditLogger.log({
			actionType: 'assessment_graded',
			userId: userId,
			targetType: 'skill_assessment',
			targetId: result.assessmentId,
			metadata: {
				session_id: sessionId,
				skill_id: result.skillId,
				score: result.score ?? null,
				passed: result.passed,
				anti_cheat_score: result.antiCheatScore,
				model_version: 'adaptive-assessment-v1',
				...(result.partial
					? {
							partial: true,
							answers_given: result.answersGiven,
							total_questions: result.totalQuestions,
							fullscreen_auto_submit: result.fullscreenAutoSubmit === true,
						}
					: {}),
				// #1584: NO confidence key — no confidence was measured for
				// this grading, and a hard-coded 0.85/0.6 in the compliance
				// audit trail is a fabrication (same class as #1572/#1505).
				// The admin compliance readers surface the absence honestly.
			},
			req: null,
		});
	}
	return result;
}

// Phase B (#1604/#1605, design §4.1): Exit Exam — the mirror image of the
// completion claim. ONE atomic status-guarded UPDATE moves the session to
// 'abandoned'; it writes NOTHING else: no skill_assessments row, no
// evaluation, no OmniScore call, no graded audit. The exit_exam event row
// is written server-side in the same transaction so the abandon record
// never depends on a client post. The claim sets abandoned_at and leaves
// completed_at NULL (database-reviewer STOP 1 condition — see migration
// 276). Returns { abandoned: true, answersGiven } on a won claim,
// { already: true, status } when the attempt was already terminal, or
// null on a database failure.
async function abandonSessionTx(sessionId, userId, reason) {
	let client;
	try {
		client = await pool.connect();
		await client.query('BEGIN');
		const claim = await client.query(
			`UPDATE assessment_sessions
			 SET status = 'abandoned', abandoned_at = NOW(), current_draft = NULL
			 WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
			 RETURNING answers_given`,
			[sessionId, userId],
		);
		if (claim.rows.length === 0) {
			const existing = await client.query(
				'SELECT status FROM assessment_sessions WHERE id = $1 AND user_id = $2',
				[sessionId, userId],
			);
			await client.query('ROLLBACK');
			if (existing.rows.length === 0) return { notFound: true };
			return { already: true, status: existing.rows[0].status };
		}
		const answersGiven = parseJsonArray(claim.rows[0].answers_given).length;
		await client.query(
			`INSERT INTO assessment_events (session_id, event_type, event_data) VALUES ($1, 'exit_exam', $2)`,
			[sessionId, JSON.stringify({ answersGiven, reason: reason || 'candidate' })],
		);
		await client.query('COMMIT');
		return { abandoned: true, answersGiven };
	} catch (error) {
		if (client) await client.query('ROLLBACK').catch(() => {});
		console.error('Error abandoning assessment session:', error);
		return null;
	} finally {
		if (client) client.release();
	}
}

// #1656 (R2): the count at which a session completes. Pool sessions
// complete at their promised total; SET sessions complete at the
// promised total OR when the set's servable questions run out —
// whichever comes first — so a starved set completes honestly as a
// partial instead of hanging on an unreachable total.
async function sessionCompletionThreshold(runner, session) {
	const total = sessionTotal(session);
	if (session.set_id == null) return total;
	const setCount = await setApprovedCount(runner, session.set_id);
	return Math.min(total, setCount);
}

// After an answer has been committed, decide the response from the recorded
// state alone: completed → the completion; final answer recorded but not yet
// completed → run/retry completion; otherwise → the advance acknowledgement
// (the client fetches the next question via /session/:id/current). Shared by
// the /answer main path and its duplicate-submission path so a retry after a
// timeout can never double-record or double-complete.
async function respondAfterRecord(res, sessionId, userId, extras = {}) {
	const sessionResult = await pool.query('SELECT * FROM assessment_sessions WHERE id = $1', [
		sessionId,
	]);
	const session = sessionResult.rows[0];
	if (!session) {
		return res.status(404).json({ error: 'Session not found' });
	}
	if (session.status === 'completed') {
		return res.json({ completed: true, answerRecorded: true, score: session.score || 0, ...extras });
	}
	if (session.status !== 'in_progress') {
		// Abandoned/expired/cancelled between the answer commit and here:
		// the attempt ended WITHOUT completing — say so, never report a
		// completion that did not happen.
		return res
			.status(400)
			.json({ error: 'This attempt is already finished', code: 'ALREADY_FINISHED' });
	}
	const answersGiven = parseJsonArray(session.answers_given);
	if (answersGiven.length >= (await sessionCompletionThreshold(pool, session))) {
		const completion = await completeAssessmentTx(sessionId, userId);
		if (completion) {
			return res.json({
				completed: true,
				answerRecorded: true,
				score: completion.score ?? session.score ?? 0,
				...extras,
			});
		}
		return res.status(503).json({
			error:
				'Your final answer has been saved, but finishing your results failed. Please retry — your answers are not lost.',
			code: 'COMPLETION_PENDING',
			retryable: true,
			answerRecorded: true,
		});
	}
	return res.json({
		completed: false,
		answerRecorded: true,
		answersGiven: answersGiven.length,
		...extras,
	});
}

// #1656 (C3, R3/§5.3): the user's most recent COMPLETED attempt's asked
// question ids, in the order they were asked (oldest first — the order
// starvation relaxation gives them back in). Keyed by topic when the
// session has one; legacy topic-less sessions fall back to the most
// recent completed attempt for the skill. Only status='completed'
// sessions are read: an abandoned attempt contributes NOTHING — no lock
// (the /start gate already reads completed rows only) and no exclusion.
async function loadPreviousCompletedQuestionIds(client, session) {
	const byTopic = session.topic_id != null;
	const result = await client.query(
		byTopic
			? `SELECT questions_asked FROM assessment_sessions
       WHERE user_id = $1 AND topic_id = $2 AND status = 'completed' AND id <> $3
       ORDER BY completed_at DESC LIMIT 1`
			: `SELECT questions_asked FROM assessment_sessions
       WHERE user_id = $1 AND skill_id = $2 AND status = 'completed' AND id <> $3
       ORDER BY completed_at DESC LIMIT 1`,
		[session.user_id, byTopic ? session.topic_id : session.skill_id, session.id],
	);
	if (result.rows.length === 0) return [];
	return parseJsonArray(result.rows[0].questions_asked)
		.map((q) => q.questionId)
		.filter(Number.isInteger);
}

// §5.3 soft exclusion, applied exactly: the previous attempt's ids are
// excluded ONLY while the remaining pool at the needed (format,
// difficulty) — after the hard in-session exclusion — still meets the
// session's remaining count. When it would starve the session, the
// exclusion relaxes OLDEST-first (the earliest-asked ids come back
// first) until the pool meets the count or nothing is left to relax.
async function applySoftExclusion(client, { skillName, difficulty, session, scoped, formatPredicate }, excludeIds, softExcludeIds) {
	const poolResult = scoped
		? await client.query(
				`SELECT id FROM assessment_questions
     WHERE topic_id = $1 AND ${formatPredicate} AND review_status = 'approved'
       AND difficulty_level = $2
       AND NOT (id = ANY($3::int[]))`,
				[session.topic_id, difficulty, excludeIds],
			)
		: await client.query(
				`SELECT id FROM assessment_questions
     WHERE LOWER(skill_category) = LOWER($1) AND difficulty_level = $2
       AND NOT (id = ANY($3::int[]))`,
				[skillName, difficulty, excludeIds],
			);
	const poolIds = new Set(poolResult.rows.map((r) => r.id));
	const softInPool = softExcludeIds.filter((id) => poolIds.has(id));
	const remaining = Math.max(1, sessionTotal(session) - parseJsonArray(session.answers_given).length);
	let available = poolIds.size - softInPool.length;
	while (available < remaining && softInPool.length > 0) {
		softInPool.shift(); // oldest first
		available += 1;
	}
	return [...excludeIds, ...softInPool];
}

// Helper: Generate or fetch question.
// Phase A (#1606): excludeIds lists questions already asked in the session —
// while unserved bank rows exist at this difficulty, a session never re-serves
// a question it already asked (a 1-row cell previously repeated forever).
// #1654 (C2): a session WITH a snapshot (topic_id + format recorded) serves
// from the scoped pool — topic + format predicate (§4.6: mixed is the
// mcq/short_answer union, never a literal equality) + approved-only (§7
// rule 6) — in the Q2 order: bank-first → AI generation → in-scope approved
// re-serve → null. A NULL-config session (in-flight legacy, §8) — or a
// legacy-mapped session whose skill has no catalogue topic — keeps today's
// exact skill_category path and order untouched. The format predicate is
// interpolated from the validated snapshot enum (a closed set), never
// from request input.
async function generateQuestion(skillName, category, difficulty, client, excludeIds = [], session = null, softExcludeIds = []) {
	const scoped = !!(session && session.topic_id != null && session.format);
	let formatPredicate = null;
	if (scoped) {
		formatPredicate =
			session.format === 'mixed' ? `format IN ('mcq','short_answer')` : `format = '${session.format}'`;
	}
	// #1656 (R3/§5.3): fold the soft cross-attempt exclusion into the
	// hard in-session exclusion for the bank draws below. The AI leg and
	// the final re-serve fallback are deliberately NOT soft-excluded —
	// they are the starvation relief valves, in the existing order.
	let effectiveExcludeIds = excludeIds;
	if (softExcludeIds.length > 0 && session) {
		effectiveExcludeIds = await applySoftExclusion(
			client,
			{ skillName, difficulty, session, scoped, formatPredicate },
			excludeIds,
			softExcludeIds,
		);
	}
	if (scoped) {
		const existingResult = await client.query(
			`
    SELECT * FROM assessment_questions
    WHERE topic_id = $1 AND ${formatPredicate} AND review_status = 'approved'
      AND difficulty_level = $2
      AND NOT (id = ANY($3::int[]))
    ORDER BY RANDOM()
    LIMIT 1
  `,
			[session.topic_id, difficulty, effectiveExcludeIds],
		);
		if (existingResult.rows.length > 0) {
			return existingResult.rows[0];
		}
		// Q2: for a promised configuration, fresh AI supply is tried BEFORE
		// any duplicate is re-served; the re-serve below is the last resort.
		const generated = await generateViaAI(skillName, category, difficulty, client, session);
		if (generated) {
			return generated;
		}
		const retryResult = await client.query(
			`
    SELECT * FROM assessment_questions
    WHERE topic_id = $1 AND ${formatPredicate} AND review_status = 'approved'
      AND difficulty_level = $2
    ORDER BY RANDOM()
    LIMIT 1
  `,
			[session.topic_id, difficulty],
		);
		if (retryResult.rows.length > 0) {
			return retryResult.rows[0];
		}
		return null;
	}

	// Try to find existing question from bank
	const existingResult = await client.query(
		`
    SELECT * FROM assessment_questions
    WHERE LOWER(skill_category) = LOWER($1) AND difficulty_level = $2
      AND NOT (id = ANY($3::int[]))
    ORDER BY RANDOM()
    LIMIT 1
  `,
		[skillName, difficulty, effectiveExcludeIds],
	);

	if (existingResult.rows.length > 0) {
		return existingResult.rows[0];
	}

	// #1656: when a soft exclusion was folded in, fresh AI supply is
	// tried BEFORE any already-asked question is re-served (the scoped
	// path's Q2 order) — re-serving a previous attempt's question is the
	// last resort, not the second. Without a soft exclusion the historic
	// order below is byte-for-byte today's.
	if (softExcludeIds.length > 0) {
		const generated = await generateViaAI(skillName, category, difficulty, client, null);
		if (generated) return generated;
	}

	if (excludeIds.length > 0) {
		// Every bank row at this difficulty was already asked in this session.
		// Re-serving one beats failing the candidate's navigation outright;
		// generation below remains the first choice only for an empty cell.
		const retryResult = await client.query(
			`
      SELECT * FROM assessment_questions
      WHERE LOWER(skill_category) = LOWER($1) AND difficulty_level = $2
      ORDER BY RANDOM()
      LIMIT 1
    `,
			[skillName, difficulty],
		);
		if (retryResult.rows.length > 0) {
			return retryResult.rows[0];
		}
	}

	return generateViaAI(skillName, category, difficulty, client, null);
}

// The AI generation leg, shared by both serving paths. For a snapshot
// session the question type is driven by the session's format (mcq →
// multiple_choice only, short_answer → short_answer only, mixed → either)
// and the INSERT writes the §3.4 provenance (topic_id, derived format,
// source 'ai_live', review_status 'pending') — the row is returned
// directly to its own session but is NOT servable bank supply for anyone
// until curation approves it. Legacy (session null) keeps the historical
// coin flip and the historical INSERT, byte for byte.
async function generateViaAI(skillName, category, difficulty, client, session) {
	const scoped = !!(session && session.topic_id != null && session.format);
	// Generate new question using AI
	let questionType;
	if (!scoped) {
		questionType = Math.random() > 0.3 ? 'multiple_choice' : 'short_answer';
	} else if (session.format === 'mcq') {
		questionType = 'multiple_choice';
	} else if (session.format === 'short_answer') {
		questionType = 'short_answer';
	} else if (session.format === 'mixed') {
		questionType = Math.random() > 0.3 ? 'multiple_choice' : 'short_answer';
	} else {
		// coding: generation is C4's runner work — bank-only until then.
		return null;
	}
	const prompt = `Generate a difficulty ${difficulty}/5 technical assessment question about "${skillName}" (category: ${category}).

Question type: ${questionType}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "question_text": "The question text here",
  "question_type": "${questionType}",
  ${questionType === 'multiple_choice' ? '"options": ["Option A text", "Option B text", "Option C text", "Option D text"],\n  "correct_answer": "Option A text",' : ''}
  "explanation": "Brief explanation of the correct answer",
  "time_limit_seconds": ${questionType === 'multiple_choice' ? '90' : '180'}
}

Requirements:
- Make it practical and relevant to real-world ${skillName} work
- Difficulty ${difficulty}/5 (1=beginner, 5=expert)
- ${questionType === 'multiple_choice' ? 'Provide exactly 4 options. correct_answer must exactly match one of the options.' : 'Ask a question that requires a detailed written response.'}
- Keep question clear and unambiguous`;

	try {
		const response = await chat(prompt, {
			maxTokens: 1024,
			module: 'assessments',
			feature: 'question_generation',
		});

		// Parse response - handle potential markdown code blocks
		let cleanResponse = response.trim();
		if (cleanResponse.startsWith('```')) {
			cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
		}

		const questionData = JSON.parse(cleanResponse);

		// Validate the response
		if (!questionData.question_text) {
			throw new Error('Missing question_text in AI response');
		}

		const qType = questionData.question_type || questionType;
		const options =
			qType === 'multiple_choice' && questionData.options
				? typeof questionData.options === 'string'
					? questionData.options
					: JSON.stringify(questionData.options)
				: null;

		// Save to database. Snapshot sessions write the §3.4 provenance so
		// the row's origin is auditable; format is derived from the type
		// exactly as migration 280 derived it. Legacy keeps its INSERT.
		const derivedFormat = qType === 'multiple_choice' ? 'mcq' : qType === 'short_answer' ? 'short_answer' : 'coding';
		const result = scoped
			? await client.query(
					`
      INSERT INTO assessment_questions
      (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds,
       topic_id, format, source, review_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ai_live', 'pending')
      RETURNING *
    `,
					[
						skillName,
						difficulty,
						qType,
						questionData.question_text,
						options,
						questionData.correct_answer || null,
						questionData.explanation || 'See the correct answer above.',
						questionData.time_limit_seconds || (qType === 'multiple_choice' ? 90 : 180),
						session.topic_id,
						derivedFormat,
					],
				)
			: await client.query(
					`
      INSERT INTO assessment_questions
      (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
					[
						skillName,
						difficulty,
						qType,
						questionData.question_text,
						options,
						questionData.correct_answer || null,
						questionData.explanation || 'See the correct answer above.',
						questionData.time_limit_seconds || (qType === 'multiple_choice' ? 90 : 180),
					],
				);

		return result.rows[0];
	} catch (error) {
		console.error('Error generating AI question:', error);

		// #1573: fail honestly. Never serve a bank question outside the
		// requested skill/difficulty as a substitute, and never INSERT
		// templated/boilerplate content into assessment_questions as if it
		// were a real question. Returning null surfaces the callers'
		// explicit question-unavailable state — since Phase A (#1602/#1606)
		// that state is a navigation outcome only: it never rolls back a
		// recorded answer and never destroys a started session, and a
		// retry can succeed; a fabricated question served in a scored
		// assessment can never be un-taken.
		return null;
	}
}

// Helper: Evaluate short answer
async function evaluateShortAnswer(question, answer, rubric) {
	const prompt = `Evaluate this short answer response to a technical assessment question.

Question: ${question}

Student's Answer: ${answer}

Expected concepts: ${rubric}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "score": <number 0-100>,
  "feedback": "<brief feedback explaining the score>"
}

Score guide: 90-100=excellent, 70-89=good, 50-69=partial, below 50=incorrect`;

	try {
		const response = await chat(prompt, {
			maxTokens: 512,
			module: 'assessments',
			feature: 'answer_evaluation',
		});
		let cleanResponse = response.trim();
		if (cleanResponse.startsWith('```')) {
			cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
		}
		const parsed = JSON.parse(cleanResponse);
		// #1572: a reply without a real numeric score in the promised 0–100
		// range is not an evaluation — minting points from it (or NaN, or a
		// confidence of 1.5 / −0.2 in the audit log) would fabricate a
		// result. Reject, never clamp: a clamped value is also a score the
		// AI never gave.
		if (
			!parsed ||
			typeof parsed.score !== 'number' ||
			!Number.isFinite(parsed.score) ||
			parsed.score < 0 ||
			parsed.score > 100
		) {
			return null;
		}
		return parsed;
	} catch (error) {
		console.error('Error evaluating answer:', error);
		// #1572: evaluation failed — return null so the caller records the
		// answer as unevaluated (pending manual review). NEVER a default
		// score: a fabricated 50 was credited into the session total and
		// audit-logged as an AI score with confidence 0.5.
		return null;
	}
}

// Helper: Complete assessment.
// Phase A (#1602 FR-A3): the terminal transition is ONE atomic status-guarded
// UPDATE — its rowcount decides the winner of any race (double Finish,
// timer + manual press, retry after timeout). The loser finds no row to
// claim and gets the existing completion back instead of double-scoring.
// Phase B (#1604/#1605): shared stored-but-not-answered draft reader.
// A draft is the candidate's own unsubmitted work on the current question —
// never an answer, never evaluated, never recruiter-visible (design §8.2).
function parseDraft(value) {
	if (!value) return null;
	if (typeof value === 'object' && !Array.isArray(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

function parseJsonObject(value, fallback = {}) {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
		} catch {
			return fallback;
		}
	}
	return fallback;
}

// Phase B (design §5.3, database-reviewer STOP 1 condition): whole-exam
// pause credit for the job runner, from RECORDED timer_pause_start /
// timer_pause_end events (server receipt timestamps). Intervals that
// overlap are merged first, the 300s cap applies to each MERGED interval
// (never per-posted-event, so nested/overlapping pairs cannot double-count),
// and a pause_start with no following pause_end credits nothing — an open
// pause is visible in the event log for human review, never auto-credited.
// events: [{ type, timestamp }] in any order.
function pauseCreditSeconds(events, nowMs) {
	const pairs = [];
	let openStart = null;
	const sorted = (Array.isArray(events) ? events : [])
		.filter((e) => e && (e.type === 'timer_pause_start' || e.type === 'timer_pause_end'))
		.map((e) => ({ type: e.type, t: new Date(e.timestamp).getTime() }))
		.filter((e) => Number.isFinite(e.t))
		.sort((a, b) => a.t - b.t);
	for (const e of sorted) {
		if (e.type === 'timer_pause_start') {
			if (openStart === null) openStart = e.t;
		} else if (openStart !== null) {
			pairs.push([openStart, e.t]);
			openStart = null;
		}
	}
	if (openStart !== null && Number.isFinite(nowMs)) {
		// Still paused at read time is not a completed interval: no credit.
	}
	pairs.sort((a, b) => a[0] - b[0]);
	const merged = [];
	for (const [s, e] of pairs) {
		const last = merged[merged.length - 1];
		if (last && s <= last[1]) last[1] = Math.max(last[1], e);
		else merged.push([s, e]);
	}
	return merged.reduce((sum, [s, e]) => sum + Math.min(300, Math.max(0, (e - s) / 1000)), 0);
}

// Runs inside the caller's transaction (completeAssessmentTx).
// Phase B opts: { reason?: 'candidate' | 'fullscreen_second_exit' } — a
// completion reached with fewer than the session's promised count
// (sessionTotal — snapshot total_questions, else the legacy 10) of recorded
// answers is a
// PARTIAL terminal submission (Submit & Exit / full-screen auto-submit).
async function completeAssessment(client, sessionId, userId, opts = {}) {
	const claim = await client.query(
		`UPDATE assessment_sessions
		 SET status = 'completed', completed_at = NOW(), current_draft = NULL
		 WHERE id = $1 AND status = 'in_progress'
		 RETURNING *`,
		[sessionId],
	);

	if (claim.rows.length === 0) {
		const existing = await client.query(
			`SELECT id, score, passed, behavioral_flags FROM skill_assessments
			 WHERE session_id = $1 ORDER BY completed_at DESC LIMIT 1`,
			[sessionId],
		);
		// alreadyCompleted is only true when a completion actually exists.
		// A claim can also lose to a NON-completion terminal transition
		// (a newer /start abandoned this session): then there is no
		// skill_assessments row, and reporting a completion would
		// fabricate one — return null so callers surface an honest
		// non-completed state instead (review finding, PR #1620).
		if (existing.rows.length === 0) {
			return null;
		}
		const exFlags = parseJsonObject(existing.rows[0].behavioral_flags);
		return {
			alreadyCompleted: true,
			assessmentId: existing.rows[0].id,
			score: existing.rows[0].score,
			passed: existing.rows[0].passed,
			partial: exFlags.partial === true,
			answersGiven: exFlags.answers_given ?? null,
			totalQuestions: exFlags.total_questions ?? LEGACY_TOTAL_QUESTIONS,
			correctCount: exFlags.correct_count ?? null,
			fullscreenAutoSubmit: exFlags.fullscreen_auto_submit === true,
		};
	}

	const session = claim.rows[0];

	// Get skill name for the title
	const skillResult = await client.query('SELECT skill_name FROM candidate_skills WHERE id = $1', [
		session.skill_id,
	]);
	const skillName = skillResult.rows.length > 0 ? skillResult.rows[0].skill_name : 'Unknown';

	// Calculate anti-cheat score (100 = clean, lower = suspicious)
	let antiCheatScore = 100;
	antiCheatScore -= (session.tab_switches || 0) * 5;
	antiCheatScore -= (session.copy_paste_attempts || 0) * 10;
	antiCheatScore -= (session.time_anomalies || 0) * 5;
	antiCheatScore = Math.max(0, antiCheatScore);

	// Phase B partial terminal submission (FOUNDER RULING, Sumanth
	// 2026-10-21): scored over ANSWERED questions only, labelled plainly as
	// partial (answered X of Y) wherever shown, NOT eligible for
	// pass/Verified, and does NOT feed OmniScore (the feed lives in
	// completeAssessmentTx and keys off result.partial). The score math runs
	// HERE, inside the claim transaction, from the claim-returned session
	// row; the answered questions are read FOR UPDATE under the same lock
	// discipline as the claim (database-reviewer STOP 1 condition — no
	// pool-side recompute after commit).
	// #1654 STOP 1 Q5: ONE score path for EVERY completion — partial,
	// configured, and legacy. The non-partial branch previously wrote the
	// RAW Σ scorePoints against max_score=100 (a proven 440-vs-100 defect
	// on surfaces recruiters read) and decided `passed` by comparing raw
	// points to a percentage-shaped 60. Now every completion writes
	// score = round(Σ scorePoints / Σ maxPoints × 100) with max_score 100
	// — the partial branch's existing §8 formula, generalised — and
	// passed / Verified / the OmniScore feed all consume the percentage.
	const answersGivenArr = parseJsonArray(session.answers_given);
	const answersGivenCount = answersGivenArr.length;
	const totalQuestions = sessionTotal(session);
	const isPartial = answersGivenCount < totalQuestions;
	const fullscreenAutoSubmit = opts.reason === 'fullscreen_second_exit';
	let score = null;
	let maxScore = null;
	let correctCount = null;
	if (answersGivenCount === 0) {
		// Nothing was answered: there is nothing to score — no number at
		// all (never a fabricated 0), per the Candidate Experience ruling.
		score = null;
		maxScore = null;
	} else {
		correctCount = answersGivenArr.filter((a) => a.isCorrect === true).length;
		const qIds = [...new Set(answersGivenArr.map((a) => Number(a.questionId)).filter(Number.isInteger))];
		const qRows = await client.query(
			'SELECT id, difficulty_level, question_type FROM assessment_questions WHERE id = ANY($1) FOR UPDATE',
			[qIds],
		);
		const qMap = new Map(qRows.rows.map((q) => [q.id, q]));
		let maxAnswered = 0;
		for (const a of answersGivenArr) {
			const q = qMap.get(Number(a.questionId));
			if (!q) continue;
			maxAnswered += (q.difficulty_level || 2) * (q.question_type === 'short_answer' ? 15 : 10);
		}
		const earned = answersGivenArr.reduce((sum, a) => sum + (Number(a.scorePoints) || 0), 0);
		score = maxAnswered > 0 ? Math.round((earned / maxAnswered) * 100) : null;
		maxScore = maxAnswered > 0 ? 100 : null;
	}

	const passed = !isPartial && score != null && score >= 60 && antiCheatScore >= 50;

	// Create skill assessment record
	const assessmentResult = await client.query(
		`
    INSERT INTO skill_assessments
    (user_id, skill_id, session_id, assessment_type, title, score, max_score, passed,
     anti_cheat_score, behavioral_flags, duration_seconds, started_at, completed_at)
    VALUES ($1, $2, $3, 'dynamic', $4, $5, $10, $6, $7, $8,
            EXTRACT(EPOCH FROM (NOW() - $9::timestamp)), $9, NOW())
    RETURNING id
  `,
		[
			userId,
			session.skill_id,
			sessionId,
			`${skillName} Assessment`,
			score,
			passed,
			antiCheatScore,
			JSON.stringify({
				tab_switches: session.tab_switches || 0,
				copy_paste: session.copy_paste_attempts || 0,
				time_anomalies: session.time_anomalies || 0,
				max_difficulty: session.max_difficulty_reached || 2,
				...(isPartial
					? {
							partial: true,
							answers_given: answersGivenCount,
							total_questions: totalQuestions,
							correct_count: correctCount,
							fullscreen_auto_submit: fullscreenAutoSubmit,
						}
					: {}),
				...(!isPartial && fullscreenAutoSubmit ? { fullscreen_auto_submit: true } : {}),
			}),
			session.started_at,
			maxScore,
		],
	);

	// If passed, mark skill as verified (a partial can never pass — the
	// founder ruling — so this write is unreachable for partial claims).
	if (passed) {
		await client.query(
			'UPDATE candidate_skills SET is_verified = true, verified_at = NOW(), verified_score = $1 WHERE id = $2',
			[score, session.skill_id],
		);
	}

	// #1612 (Rex + ecc database-reviewer STOP 1 ruling — Option B): the
	// OmniScore feed and the assessment_graded audit write do NOT happen
	// here. This transaction holds the candidate_skills row lock (the
	// is_verified UPDATE above), and addTechnicalComponent works on POOL
	// connections whose calculateScore path SELECTs candidate_skills
	// FOR UPDATE (services/omniscore.js getSkillProficiency) — calling it
	// from inside this transaction deadlocks the request against itself.
	// completeAssessmentTx runs both AFTER COMMIT, when no lock is held;
	// an alreadyCompleted claim returns before them, so they fire exactly
	// once per completion.
	return {
		alreadyCompleted: false,
		assessmentId: assessmentResult.rows[0].id,
		score,
		passed,
		skillId: session.skill_id,
		antiCheatScore,
		partial: isPartial,
		answersGiven: answersGivenCount,
		totalQuestions,
		correctCount,
		fullscreenAutoSubmit,
	};
}

// Get current session state (supports page refresh during assessment + completed results)
router.get('/session/:sessionId/current', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const sessionId = req.params.sessionId;

		// Get the session
		const sessionResult = await pool.query(
			'SELECT * FROM assessment_sessions WHERE id = $1 AND user_id = $2',
			[sessionId, userId],
		);

		if (sessionResult.rows.length === 0) {
			return res.status(404).json({ error: 'Session not found' });
		}

		const session = sessionResult.rows[0];

		// Get skill name
		const skillResult = await pool.query(
			'SELECT skill_name, category FROM candidate_skills WHERE id = $1',
			[session.skill_id],
		);
		const skillName = skillResult.rows.length > 0 ? skillResult.rows[0].skill_name : 'Unknown';

		if (session.status === 'completed') {
			// Get the skill_assessment record for full results
			const assessmentResult = await pool.query(
				`
        SELECT sa.score, sa.passed, sa.anti_cheat_score, sa.duration_seconds, sa.behavioral_flags
        FROM skill_assessments sa
        WHERE sa.session_id = $1 AND sa.user_id = $2
        ORDER BY sa.completed_at DESC LIMIT 1
      `,
				[sessionId, userId],
			);

			const assessment = assessmentResult.rows[0] || {};
			// Phase B: partial completions are labelled from the stored
			// flags — the score is the answered-only score (or null when
			// nothing was answered: no number is fabricated for it).
			const cFlags = parseJsonObject(assessment.behavioral_flags);
			const cPartial = cFlags.partial === true;
			return res.json({
				status: 'completed',
				skillName,
				score: cPartial ? (assessment.score ?? null) : assessment.score || session.score || 0,
				passed: assessment.passed || false,
				antiCheatScore: assessment.anti_cheat_score ?? null,
				durationSeconds: assessment.duration_seconds || 0,
				maxDifficultyReached: session.max_difficulty_reached || 0,
				partial: cPartial,
				answersGiven: cFlags.answers_given ?? parseJsonArray(session.answers_given).length,
				totalQuestions: cFlags.total_questions ?? sessionTotal(session),
				// #1654: the §5.2/§8 configuration label from the snapshot.
				format: session.format ?? null,
				difficultyBand: session.difficulty_band ?? null,
				correctCount: cFlags.correct_count ?? null,
				autoSubmittedFullscreen: cFlags.fullscreen_auto_submit === true,
			});
		}

		if (session.status === 'in_progress') {
			const answersGiven = parseJsonArray(session.answers_given);

			// Phase A recovery: every answer is recorded but completion never
			// landed (e.g. the completion step failed after the final answer
			// committed). Finish it now — the terminal transition is atomic,
			// so this can never double-complete. #1656: the threshold is the
			// set-aware completion threshold, so a starved set session also
			// finishes here (as a partial) instead of 503-ing forever.
			if (answersGiven.length >= (await sessionCompletionThreshold(pool, session))) {
				const completion = await completeAssessmentTx(sessionId, userId);
				if (completion) {
					const doneResult = await pool.query(
						`SELECT sa.score, sa.passed, sa.anti_cheat_score, sa.duration_seconds, sa.behavioral_flags
						 FROM skill_assessments sa
						 WHERE sa.session_id = $1 AND sa.user_id = $2
						 ORDER BY sa.completed_at DESC LIMIT 1`,
						[sessionId, userId],
					);
					const assessment = doneResult.rows[0] || {};
					const dFlags = parseJsonObject(assessment.behavioral_flags);
					const dPartial = dFlags.partial === true;
					return res.json({
						status: 'completed',
						skillName,
						score: dPartial ? (assessment.score ?? null) : assessment.score || session.score || 0,
						passed: assessment.passed || false,
						antiCheatScore: assessment.anti_cheat_score ?? null,
						durationSeconds: assessment.duration_seconds || 0,
						maxDifficultyReached: session.max_difficulty_reached || 0,
						partial: dPartial,
						answersGiven: dFlags.answers_given ?? answersGiven.length,
						totalQuestions: dFlags.total_questions ?? sessionTotal(session),
						format: session.format ?? null,
						difficultyBand: session.difficulty_band ?? null,
						correctCount: dFlags.correct_count ?? null,
						autoSubmittedFullscreen: dFlags.fullscreen_auto_submit === true,
					});
				}
				return res.status(503).json({
					status: 'in_progress',
					skillName,
					code: 'COMPLETION_PENDING',
					retryable: true,
					error:
						'Your answers are saved, but finishing your results failed. Please retry.',
				});
			}

			// Serve (or re-serve) the current question. This single path is
			// what start-retry, answer-retry and page refresh all use.
			const served = await serveNextQuestion(sessionId);
			if (!served.ok) {
				return res.status(503).json({
					status: 'in_progress',
					skillName,
					code: 'QUESTION_UNAVAILABLE',
					retryable: true,
					error:
						'Your progress is saved, but the next question is not available right now. Please retry.',
				});
			}
			// Phase B (§7.3): resume restores the stored draft and the
			// full-screen exits already used, so a refresh can neither lose
			// the draft nor reset the two-exit allowance.
			const fsCount = await pool.query(
				`SELECT COUNT(*)::int AS n FROM assessment_events WHERE session_id = $1 AND event_type = 'fullscreen_exit_first'`,
				[sessionId],
			);
			return res.json({
				status: 'in_progress',
				skillName,
				question: served.question,
				format: session.format ?? null,
				difficultyBand: session.difficulty_band ?? null,
				currentDraft: parseDraft(session.current_draft),
				fullscreenExitsUsed: fsCount.rows[0]?.n || 0,
			});
		}

		// Abandoned or other status
		return res.json({ status: session.status, skillName });
	} catch (error) {
		console.error('Error fetching session current state:', error);
		res.status(500).json({ error: 'Failed to fetch session state' });
	}
});

// Get single session result (for results page redirect)
router.get('/session/:sessionId', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const sessionId = req.params.sessionId;

		const result = await pool.query(
			`
      SELECT sa.*, cs.skill_name, cs.category,
             ass.tab_switches, ass.copy_paste_attempts, ass.time_anomalies,
             ass.max_difficulty_reached, ass.answers_given, ass.started_at as session_started,
             EXTRACT(EPOCH FROM (ass.completed_at - ass.started_at)) as duration_seconds
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      WHERE ass.id = $1 AND sa.user_id = $2
      ORDER BY sa.completed_at DESC
      LIMIT 1
    `,
			[sessionId, userId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Result not found' });
		}

		res.json({ result: result.rows[0] });
	} catch (error) {
		console.error('Error fetching session result:', error);
		res.status(500).json({ error: 'Failed to fetch result' });
	}
});

// Recruiter: Get candidate assessment results (for application review)
router.get('/candidate/:candidateId', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const candidateId = req.params.candidateId;

		const result = await pool.query(
			`
      SELECT sa.id, sa.score, sa.max_score, sa.passed, sa.anti_cheat_score,
             sa.duration_seconds, sa.completed_at, sa.title,
             cs.skill_name, cs.category, cs.is_verified,
             ass.max_difficulty_reached, ass.tab_switches, ass.copy_paste_attempts
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL
      ORDER BY sa.completed_at DESC
    `,
			[candidateId],
		);

		res.json({ assessments: result.rows });
	} catch (error) {
		console.error('Error fetching candidate assessments:', error);
		res.status(500).json({ error: 'Failed to fetch candidate assessments' });
	}
});

// ========== RECRUITER ASSESSMENT MANAGEMENT ==========

// Recruiter: Get all assessment results across all candidates
router.get('/recruiter/all', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const { skill, status, sort } = req.query;

		let query = `
      SELECT sa.id, sa.score, sa.max_score, sa.passed, sa.anti_cheat_score,
             sa.duration_seconds, sa.completed_at, sa.title,
             cs.skill_name, cs.category, cs.is_verified,
             ass.max_difficulty_reached, ass.tab_switches, ass.copy_paste_attempts,
             u.name as candidate_name, u.email as candidate_email, u.id as candidate_id
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.completed_at IS NOT NULL
    `;
		const params = [];
		let paramIdx = 1;

		if (skill) {
			query += ` AND LOWER(cs.skill_name) = LOWER($${paramIdx})`;
			params.push(skill);
			paramIdx++;
		}

		if (status === 'passed') {
			query += ` AND sa.passed = true`;
		} else if (status === 'failed') {
			query += ` AND sa.passed = false`;
		}

		if (sort === 'score_desc') {
			query += ` ORDER BY sa.score DESC`;
		} else if (sort === 'score_asc') {
			query += ` ORDER BY sa.score ASC`;
		} else {
			query += ` ORDER BY sa.completed_at DESC`;
		}

		query += ` LIMIT 100`;

		const result = await pool.query(query, params);

		// Also get summary stats
		const statsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT sa.user_id) as total_candidates,
        COUNT(*) as total_assessments,
        COUNT(*) FILTER (WHERE sa.passed = true) as total_passed,
        ROUND(AVG(sa.score), 1) as avg_score,
        COUNT(DISTINCT cs.skill_name) as skills_tested
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      WHERE sa.completed_at IS NOT NULL
    `);

		// Get skill breakdown
		const skillBreakdown = await pool.query(`
      SELECT cs.skill_name, cs.category,
             COUNT(*) as attempt_count,
             COUNT(*) FILTER (WHERE sa.passed = true) as pass_count,
             ROUND(AVG(sa.score), 1) as avg_score
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      WHERE sa.completed_at IS NOT NULL
      GROUP BY cs.skill_name, cs.category
      ORDER BY attempt_count DESC
    `);

		res.json({
			assessments: result.rows,
			stats: statsResult.rows[0] || {},
			skillBreakdown: skillBreakdown.rows,
		});
	} catch (error) {
		console.error('Error fetching recruiter assessments:', error);
		res.status(500).json({ error: 'Failed to fetch assessments' });
	}
});

// Recruiter: Get assessment detail with individual question answers
router.get('/recruiter/detail/:assessmentId', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const assessmentId = req.params.assessmentId;

		const result = await pool.query(
			`
      SELECT sa.*, cs.skill_name, cs.category,
             ass.questions_asked, ass.answers_given, ass.tab_switches,
             ass.copy_paste_attempts, ass.time_anomalies, ass.max_difficulty_reached,
             ass.started_at as session_started, ass.completed_at as session_completed,
             u.name as candidate_name, u.email as candidate_email
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1
    `,
			[assessmentId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Assessment not found' });
		}

		const assessment = result.rows[0];

		// Get the actual questions for the detailed view
		const answersGiven =
			typeof assessment.answers_given === 'string'
				? JSON.parse(assessment.answers_given)
				: assessment.answers_given || [];

		const questionIds = answersGiven.map((a) => a.questionId).filter(Boolean);
		let questions = [];
		if (questionIds.length > 0) {
			const qResult = await pool.query(
				`SELECT id, question_text, question_type, correct_answer, explanation, difficulty_level
         FROM assessment_questions WHERE id = ANY($1)`,
				[questionIds],
			);
			questions = qResult.rows;
		}

		// Merge questions with answers
		const detailedAnswers = answersGiven.map((answer) => {
			const q = questions.find((q) => q.id === answer.questionId);
			return {
				...answer,
				questionText: q ? q.question_text : 'Question not found',
				questionType: q ? q.question_type : 'unknown',
				correctAnswer: q ? q.correct_answer : null,
				explanation: q ? q.explanation : null,
				difficulty: q ? q.difficulty_level : null,
			};
		});

		res.json({
			assessment: {
				...assessment,
				detailedAnswers,
			},
		});
	} catch (error) {
		console.error('Error fetching assessment detail:', error);
		res.status(500).json({ error: 'Failed to fetch assessment detail' });
	}
});

// Recruiter: Get the available skill catalog (for assigning)
// POST /api/assessments/assign — Recruiter assigns an assessment to a candidate application
router.post('/assign', authMiddleware, async (req, res) => {
	try {
		// Hiring-team only (#343 task 2) — checked before anything else so
		// unauthorized callers learn nothing about applications or assessments.
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required', code: 'RECRUITER_ONLY' });
		}

		const { assessment_id, application_id } = req.body;
		if (!assessment_id || !application_id) {
			return res.status(400).json({ error: 'assessment_id and application_id are required' });
		}

		// Optional deadline (#343 task 3): must be a valid future timestamp.
		let dueDate = null;
		if (req.body.due_date !== undefined && req.body.due_date !== null) {
			dueDate = new Date(req.body.due_date);
			if (Number.isNaN(dueDate.getTime())) {
				return res
					.status(400)
					.json({ error: 'due_date must be a valid timestamp', code: 'INVALID_DUE_DATE' });
			}
			if (dueDate <= new Date()) {
				return res
					.status(400)
					.json({ error: 'due_date must be in the future', code: 'INVALID_DUE_DATE' });
			}
		}

		// Verify the application belongs to the recruiter's company and get candidate/job
		const app = await pool.query(
			`SELECT ja.id, ja.candidate_id, ja.job_id, ja.company_id, j.title as job_title, u.name as candidate_name
       FROM job_applications ja
       JOIN jobs j ON j.id = ja.job_id
       JOIN users u ON u.id = ja.candidate_id
       WHERE ja.id = $1 AND ja.company_id = $2`,
			[application_id, req.user.company_id],
		);
		if (app.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}
		const a = app.rows[0];

		// Verify the assessment exists and belongs to the company (via its job)
		const asm = await pool.query(
			`SELECT ja.id, ja.title FROM job_assessments ja
       JOIN jobs j ON j.id = ja.job_id
       WHERE ja.id = $1 AND j.company_id = $2`,
			[assessment_id, req.user.company_id],
		);
		if (asm.rows.length === 0) {
			return res.status(404).json({ error: 'Assessment not found' });
		}

		// Dedup: don't assign twice while one is still open
		const existing = await pool.query(
			`SELECT id FROM job_assessment_attempts
       WHERE assessment_id = $1 AND application_id = $2 AND status IN ('assigned','in_progress')`,
			[assessment_id, application_id],
		);
		if (existing.rows.length > 0) {
			return res.status(409).json({ error: 'Assessment already assigned', attempt_id: existing.rows[0].id });
		}

		const attempt = await pool.query(
			`INSERT INTO job_assessment_attempts (assessment_id, candidate_id, application_id, status, due_date)
       VALUES ($1, $2, $3, 'assigned', $4) RETURNING *`,
			[assessment_id, a.candidate_id, application_id, dueDate],
		);

		// Auto-advance application status (don't override manual moves)
		await pool.query(
			`UPDATE job_applications SET status = CASE WHEN status IN ('applied', 'screening') THEN 'shortlisted' ELSE status END, updated_at = NOW() WHERE id = $1`,
			[application_id],
		);

		// In-app notification for the candidate (non-blocking).
		// metadata.url deep-links the notification center's "View" action
		// straight to the take page (notification-center.tsx).
		notifyUser(
			a.candidate_id,
			'assessment_assigned',
			'Skill assessment assigned',
			`You've been assigned the "${asm.rows[0].title}" assessment for ${a.job_title}. Complete it to continue in the hiring process.`,
			{
				attempt_id: attempt.rows[0].id,
				assessment_id,
				application_id,
				job_id: a.job_id,
				url: `/candidate/job-assessment/${assessment_id}`,
			},
		);

		res.json({ success: true, attempt: attempt.rows[0] });
	} catch (err) {
		console.error('Assign assessment error:', err);
		res.status(500).json({ error: 'Failed to assign assessment' });
	}
});

// Referral links (#349): recruiter generates a tokenized link for a candidate
// by email. The candidate signs up / logs in, claims it, and lands in a
// pre-assigned attempt. Raw tokens are never stored (sha256 only, following
// the oauth_exchange_codes pattern from migration 230).
function hashReferralToken(rawToken) {
	return crypto.createHash('sha256').update(rawToken).digest('hex');
}

const REFERRAL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/assessments/refer/claim — candidate claims a referral after auth.
// Idempotent: re-claim by the same user returns the existing application/attempt.
router.post('/refer/claim', authMiddleware, rateLimits.strict, async (req, res) => {
	try {
		const { token } = req.body;
		if (!token || typeof token !== 'string') {
			return res.status(400).json({ error: 'token is required' });
		}

		const tokenHash = hashReferralToken(token);
		const ref = await pool.query(
			`SELECT ar.*, ja.job_id, ja.title as assessment_title
       FROM assessment_referrals ar
       JOIN job_assessments ja ON ja.id = ar.job_assessment_id
       WHERE ar.token_hash = $1`,
			[tokenHash],
		);
		if (ref.rows.length === 0) {
			return res.status(404).json({ error: 'Referral not found' });
		}
		const referral = ref.rows[0];

		if (referral.due_date && new Date(referral.due_date) < new Date()) {
			return res.status(410).json({ error: 'Referral expired', code: 'REFERRAL_EXPIRED' });
		}

		// Links aren't transferable: the claimant's email must match.
		if ((req.user.email || '').toLowerCase() !== (referral.email || '').toLowerCase()) {
			return res.status(403).json({ error: 'This referral was issued to a different email' });
		}

		// Already claimed by someone else.
		if (referral.claimed_by_user_id && referral.claimed_by_user_id !== req.user.id) {
			return res.status(409).json({ error: 'Referral already claimed' });
		}

		await pool.query('BEGIN');
		try {
			// Atomically claim (single-claim enforced by the WHERE clause).
			if (!referral.claimed_by_user_id) {
				const claimed = await pool.query(
					`UPDATE assessment_referrals SET claimed_by_user_id = $1, claimed_at = NOW()
           WHERE id = $2 AND claimed_by_user_id IS NULL`,
					[req.user.id, referral.id],
				);
				if (claimed.rowCount === 0) {
					await pool.query('ROLLBACK');
					return res.status(409).json({ error: 'Referral already claimed' });
				}
			}

			// Find or create the application (UNIQUE(job_id, candidate_id)).
			const app = await pool.query(
				`SELECT id, status FROM job_applications WHERE job_id = $1 AND candidate_id = $2`,
				[referral.job_id, req.user.id],
			);
			let applicationId;
			if (app.rows.length > 0) {
				applicationId = app.rows[0].id;
			} else {
				const job = await pool.query(`SELECT company_id FROM jobs WHERE id = $1`, [
					referral.job_id,
				]);
				const created = await pool.query(
					`INSERT INTO job_applications (candidate_id, job_id, company_id, status, applied_via)
           VALUES ($1, $2, $3, 'applied', 'referral') RETURNING id`,
					[req.user.id, referral.job_id, job.rows[0]?.company_id || null],
				);
				applicationId = created.rows[0].id;
			}

			// Find or create the attempt: resume in-progress, return completed, else assign.
			const existing = await pool.query(
				`SELECT id, status, composite_score FROM job_assessment_attempts
         WHERE assessment_id = $1 AND candidate_id = $2 AND status IN ('assigned','in_progress','completed')
         ORDER BY created_at DESC LIMIT 1`,
				[referral.job_assessment_id, req.user.id],
			);
			let attempt;
			if (existing.rows.length > 0) {
				attempt = existing.rows[0];
			} else {
				const created = await pool.query(
					`INSERT INTO job_assessment_attempts (assessment_id, candidate_id, application_id, status, due_date)
           VALUES ($1, $2, $3, 'assigned', $4) RETURNING id, status`,
					[referral.job_assessment_id, req.user.id, applicationId, referral.due_date],
				);
				attempt = created.rows[0];
			}

			await pool.query('COMMIT');
			res.json({
				application_id: applicationId,
				attempt_id: attempt.id,
				status: attempt.status,
				composite_score: attempt.composite_score ?? null,
				redirect_url: `/candidate/job-assessment/${referral.job_assessment_id}`,
			});
		} catch (err) {
			await pool.query('ROLLBACK');
			throw err;
		}
	} catch (err) {
		console.error('Claim referral error:', err);
		res.status(500).json({ error: 'Failed to claim referral' });
	}
});

// POST /api/assessments/:id/refer — hiring-team only. Creates a referral link.
router.post('/:id/refer', authMiddleware, rateLimits.strict, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required', code: 'RECRUITER_ONLY' });
		}

		const { email, due_date } = req.body;
		if (!email || !REFERRAL_EMAIL_RE.test(email)) {
			return res.status(400).json({ error: 'A valid email is required' });
		}

		// Assessment must exist, be published, and belong to the recruiter's company.
		const asm = await pool.query(
			`SELECT ja.id, ja.title FROM job_assessments ja
       JOIN jobs j ON j.id = ja.job_id
       WHERE ja.id = $1 AND j.company_id = $2 AND ja.status = 'published'`,
			[req.params.id, req.user.company_id],
		);
		if (asm.rows.length === 0) {
			return res.status(404).json({ error: 'Published assessment not found' });
		}

		let dueDate = new Date(Date.now() + 30 * 864e5); // default 30 days
		if (due_date !== undefined && due_date !== null) {
			dueDate = new Date(due_date);
			if (Number.isNaN(dueDate.getTime())) {
				return res.status(400).json({ error: 'due_date must be a valid timestamp' });
			}
			if (dueDate <= new Date()) {
				return res.status(400).json({ error: 'due_date must be in the future' });
			}
		}

		const rawToken = crypto.randomBytes(32).toString('hex');
		const tokenHash = hashReferralToken(rawToken);
		const created = await pool.query(
			`INSERT INTO assessment_referrals (job_assessment_id, email, token_hash, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, due_date`,
			[req.params.id, email.toLowerCase(), tokenHash, req.user.id, dueDate],
		);

		res.json({
			referral_url: `/r/${rawToken}`,
			expires_at: created.rows[0].due_date,
		});
	} catch (err) {
		console.error('Create referral error:', err);
		res.status(500).json({ error: 'Failed to create referral' });
	}
});

// GET /api/assessments/refer/:token/preview — public. Sanitized assessment info.
// Never includes correct_answer, rubric, explanation, or question text.
router.get('/refer/:token/preview', rateLimits.strict, async (req, res) => {
	try {
		const tokenHash = hashReferralToken(req.params.token);
		const ref = await pool.query(
			`SELECT ar.due_date, ar.email,
              ja.id, ja.title, ja.description, ja.status, ja.time_limit_minutes,
              j.title as job_title, j.company_id,
              c.name as company_name
       FROM assessment_referrals ar
       JOIN job_assessments ja ON ja.id = ar.job_assessment_id
       JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE ar.token_hash = $1`,
			[tokenHash],
		);
		if (ref.rows.length === 0) {
			return res.status(404).json({ error: 'Referral not found' });
		}
		const r = ref.rows[0];

		if (r.due_date && new Date(r.due_date) < new Date()) {
			return res.status(410).json({ error: 'Referral expired', code: 'REFERRAL_EXPIRED' });
		}
		if (r.status !== 'published') {
			return res.status(410).json({ error: 'Assessment is no longer available' });
		}

		// Evaluation dimensions: distinct question categories only.
		const cats = await pool.query(
			`SELECT DISTINCT category FROM job_assessment_questions WHERE assessment_id = $1`,
			[r.id],
		);
		const count = await pool.query(
			`SELECT COUNT(*) as count FROM job_assessment_questions WHERE assessment_id = $1`,
			[r.id],
		);

		// Company trust score: cheap read-only lookup, no side effects.
		let trustscore = null;
		if (r.company_id) {
			const ts = await pool.query(`SELECT total_score, score_tier FROM trust_scores WHERE company_id = $1`, [
				r.company_id,
			]);
			if (ts.rows.length > 0) {
				trustscore = { score: ts.rows[0].total_score, tier: ts.rows[0].score_tier };
			}
		}

		res.json({
			job_title: r.job_title,
			company_name: r.company_name,
			company_trustscore: trustscore,
			assessment_title: r.title,
			assessment_description: r.description,
			dimensions: cats.rows.map((c) => c.category),
			question_count: parseInt(count.rows[0].count, 10),
			time_limit_minutes: r.time_limit_minutes,
			due_date: r.due_date,
		});
	} catch (err) {
		console.error('Referral preview error:', err);
		res.status(500).json({ error: 'Failed to load preview' });
	}
});
router.get('/recruiter/catalog', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		res.json({ catalog: SKILL_CATALOG });
	} catch (error) {
		console.error('Error fetching skill catalog:', error);
		res.status(500).json({ error: 'Failed to fetch catalog' });
	}
});

// ========== JOB-BASED AI ASSESSMENT ENGINE ==========
// Generate assessments from job requirements, auto-score, adaptive difficulty, conversational mode

const { safeParseJSON } = require('../lib/polsia-ai');

// Recruiter: Generate AI assessment from job posting (RATE LIMITED)
router.post('/generate', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const { jobId, questionCount, difficultyBand, format } = req.body;
		if (!jobId) return res.status(400).json({ error: 'jobId is required' });

		// #1655 (C2b) R1–R3: validate optional generation config BEFORE any
		// job lookup, AI call, or write. Absent fields keep legacy behaviour.
		if (
			questionCount !== undefined &&
			(!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50)
		) {
			return res
				.status(400)
				.json({ error: 'questionCount must be a positive integer up to 50' });
		}
		if (difficultyBand !== undefined && !['easy', 'medium', 'hard'].includes(difficultyBand)) {
			return res
				.status(400)
				.json({ error: 'difficultyBand must be one of: easy, medium, hard' });
		}
		if (
			format !== undefined &&
			!['multiple_choice', 'free_text', 'scenario_response', 'code_challenge', 'mixed'].includes(
				format,
			)
		) {
			return res.status(400).json({
				error:
					'format must be one of: multiple_choice, free_text, scenario_response, code_challenge, mixed',
			});
		}

		// Get job details
		const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
		if (jobResult.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		const job = jobResult.rows[0];

		// Check if assessment already exists for this job
		const existing = await pool.query(
			'SELECT id FROM job_assessments WHERE job_id = $1 AND status != $2',
			[jobId, 'archived'],
		);
		if (existing.rows.length > 0) {
			return res.status(409).json({
				error: 'Assessment already exists for this job',
				assessmentId: existing.rows[0].id,
			});
		}

		// Detect job level from title/description for difficulty targeting
		const titleLower = (job.title || '').toLowerCase();
		const descLower = (job.description || '').toLowerCase();
		let targetLevel = 'mid';
		if (
			titleLower.includes('senior') ||
			titleLower.includes('lead') ||
			titleLower.includes('principal') ||
			titleLower.includes('staff')
		) {
			targetLevel = 'senior';
		} else if (
			titleLower.includes('junior') ||
			titleLower.includes('intern') ||
			titleLower.includes('entry') ||
			descLower.includes('0-2 years')
		) {
			targetLevel = 'junior';
		}

		// #1655 R2/R4: an explicit difficultyBand overrides the title heuristic
		// for both the stored difficulty_level and the prompt difficulty range.
		const difficultyRange = difficultyBand
			? { easy: '1-2', medium: '2-4', hard: '4-5' }[difficultyBand]
			: { junior: '1-2', mid: '2-3', senior: '3-5' }[targetLevel];

		// Map experience level to valid difficulty_level for DB constraint (easy/medium/mid/hard)
		const difficultyLevel =
			difficultyBand || { junior: 'easy', mid: 'medium', senior: 'hard' }[targetLevel] || 'medium';

		// #1655 R1/R4: effective question count and category proportions
		// (≈40/27/20/13; at the default 15 these are exactly 6/4/3/2).
		const effectiveCount = questionCount ?? 15;
		const technicalCount = Math.round(effectiveCount * 0.4);
		const scenarioCount = Math.round(effectiveCount * 0.27);
		const behavioralCount = Math.round(effectiveCount * 0.2);
		const codeChallengeCount = effectiveCount - technicalCount - scenarioCount - behavioralCount;

		// #1655 R3: a single format steers every question's question_type
		// (prompt steering only — no post-filter/retry). Absent/'mixed' = ''.
		const formatSteering =
			format && format !== 'mixed'
				? `- question_type: every question must use question_type "${format}"\n`
				: '';

		// Generate assessment questions via AI
		const prompt = `You are an expert hiring manager. Generate a comprehensive skill assessment for this job posting.

JOB TITLE: ${job.title}
COMPANY: ${job.company || 'Not specified'}
DESCRIPTION: ${(job.description || '').substring(0, 2000)}
REQUIREMENTS: ${(job.requirements || '').substring(0, 1500)}
JOB TYPE: ${job.job_type || 'full-time'}
LEVEL: ${targetLevel}

Generate exactly ${effectiveCount} assessment questions across these categories:
- "technical" (${technicalCount} questions): Test specific technical skills mentioned in requirements
- "scenario" (${scenarioCount} questions): Real-world work scenarios relevant to the role
- "behavioral" (${behavioralCount} questions): Soft skills, teamwork, communication, problem-solving
- "code_challenge" (${codeChallengeCount} questions): Practical coding/analytical problems (if technical role) OR additional scenario questions (if non-technical)

For each question, include:
- question_type: "multiple_choice", "free_text", "scenario_response", or "code_challenge"
${formatSteering}- difficulty_level: ${difficultyRange} (1=beginner, 5=expert)
- points: 5-20 based on difficulty and importance

Rules:
- Make questions SPECIFIC to this exact role, not generic
- Multiple choice: exactly 4 options, one correct
- Free text / scenario: provide a rubric for what a good answer includes
- Code challenges: provide a clear problem with expected approach
- Vary difficulty within the range

Return ONLY valid JSON:
{
  "title": "Assessment title",
  "description": "Brief assessment description",
  "questions": [
    {
      "category": "technical|scenario|behavioral|code_challenge",
      "question_type": "multiple_choice|free_text|scenario_response|code_challenge",
      "question_text": "The question",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "A",
      "rubric": "What makes a good answer (for free text/scenario)",
      "explanation": "Why the correct answer is right",
      "difficulty_level": 1-5,
      "points": 5-20,
      "time_limit_seconds": 60-300
    }
  ]
}`;

		const response = await chat(prompt, {
			maxTokens: 8000,
			response_format: { type: 'json_object' },
			system:
				'You are a senior hiring manager creating job-specific assessments. Generate practical, relevant questions that test real-world capability. Always return valid JSON.',
			module: 'assessments',
			feature: 'job_assessment_generation',
		});

		const parsed = safeParseJSON(response);
		if (!parsed?.questions || !Array.isArray(parsed.questions)) {
			console.error(
				'[assessment-gen] Failed to parse AI response. Preview:',
				String(response).slice(0, 500),
			);
			return res.status(500).json({ error: 'Failed to generate assessment. Please try again.' });
		}

		// Save assessment to database
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			const categories = [...new Set(parsed.questions.map((q) => q.category))];
			// #1655 R6: preserve the existing ai_config keys; record the
			// optional config ONLY for fields the caller actually provided.
			const aiConfig = { targetLevel, difficultyLevel, generated_at: new Date() };
			if (format !== undefined) aiConfig.format = format;
			if (questionCount !== undefined) aiConfig.requestedCount = questionCount;
			if (difficultyBand !== undefined) aiConfig.difficultyBand = difficultyBand;
			const assessmentResult = await client.query(
				`
        INSERT INTO job_assessments (job_id, created_by, title, description, difficulty_level, question_count, categories, ai_config)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
				[
					jobId,
					req.user.id,
					parsed.title || `${job.title} Assessment`,
					parsed.description || `AI-generated assessment for ${job.title}`,
					difficultyLevel,
					parsed.questions.length,
					JSON.stringify(categories),
					JSON.stringify(aiConfig),
				],
			);

			const assessment = assessmentResult.rows[0];

			// Insert questions (#1655 R5: storedCount counts rows actually inserted)
			let storedQuestionCount = 0;
			for (let i = 0; i < parsed.questions.length; i++) {
				const q = parsed.questions[i];
				await client.query(
					`
          INSERT INTO job_assessment_questions
          (assessment_id, category, question_type, question_text, options, correct_answer, rubric, explanation, difficulty_level, points, time_limit_seconds, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
					[
						assessment.id,
						q.category || 'technical',
						q.question_type || 'multiple_choice',
						q.question_text,
						q.options ? JSON.stringify(q.options) : null,
						q.correct_answer || null,
						q.rubric || null,
						q.explanation || null,
						q.difficulty_level || 3,
						q.points || 10,
						q.time_limit_seconds || 120,
						i,
					],
				);
				storedQuestionCount++;
			}

			await client.query('COMMIT');

			// Return the full assessment
			const questions = await pool.query(
				'SELECT * FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
				[assessment.id],
			);

			// #1655 R5: only when questionCount was provided does the response
			// gain requestedCount/storedCount; otherwise the shape is unchanged.
			const responseBody = {
				assessment: { ...assessment, questions: questions.rows },
			};
			if (questionCount !== undefined) {
				responseBody.requestedCount = questionCount;
				responseBody.storedCount = storedQuestionCount;
			}
			res.json(responseBody);
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		} finally {
			client.release();
		}
	} catch (error) {
		console.error('Error generating job assessment:', error);
		res.status(500).json({ error: 'Failed to generate assessment' });
	}
});

// Get job assessment (for a specific job)
router.get('/job/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = req.params.jobId;

		const result = await pool.query(
			"SELECT * FROM job_assessments WHERE job_id = $1 AND status != 'archived' ORDER BY created_at DESC LIMIT 1",
			[jobId],
		);

		if (result.rows.length === 0) {
			return res.json({ assessment: null });
		}

		const assessment = result.rows[0];
		const questions = await pool.query(
			'SELECT * FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
			[assessment.id],
		);

		// I1 (#343 review): never leak grading material to non-hiring users.
		// The candidate job-detail page calls this endpoint on every job view,
		// so full rows would expose the entire question bank with answers.
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		const questionRows = recruiterRoles.includes(req.user.role)
			? questions.rows
			: questions.rows.map(({ correct_answer, rubric, explanation, ...rest }) => rest);

		// Get attempt stats
		const stats = await pool.query(
			`
      SELECT COUNT(*) as total_attempts,
             COUNT(*) FILTER (WHERE status = 'completed') as completed,
             ROUND(AVG(composite_score) FILTER (WHERE scored_at IS NOT NULL), 1) as avg_score
      FROM job_assessment_attempts WHERE assessment_id = $1
    `,
			[assessment.id],
		);

		res.json({
			assessment: {
				...assessment,
				questions: questionRows,
				stats: stats.rows[0] || {},
			},
		});
	} catch (error) {
		console.error('Error fetching job assessment:', error);
		res.status(500).json({ error: 'Failed to fetch assessment' });
	}
});

// Recruiter: Update assessment question
router.put('/job-assessment/:id/question/:qId', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const {
			question_text,
			options,
			correct_answer,
			rubric,
			explanation,
			points,
			time_limit_seconds,
		} = req.body;

		const result = await pool.query(
			`
      UPDATE job_assessment_questions
      SET question_text = COALESCE($1, question_text),
          options = COALESCE($2, options),
          correct_answer = COALESCE($3, correct_answer),
          rubric = COALESCE($4, rubric),
          explanation = COALESCE($5, explanation),
          points = COALESCE($6, points),
          time_limit_seconds = COALESCE($7, time_limit_seconds)
      WHERE id = $8 AND assessment_id = $9
      RETURNING *
    `,
			[
				question_text || null,
				options ? JSON.stringify(options) : null,
				correct_answer || null,
				rubric || null,
				explanation || null,
				points || null,
				time_limit_seconds || null,
				req.params.qId,
				req.params.id,
			],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Question not found' });
		}

		res.json({ question: result.rows[0] });
	} catch (error) {
		console.error('Error updating question:', error);
		res.status(500).json({ error: 'Failed to update question' });
	}
});

// Recruiter: Publish assessment
router.post('/job-assessment/:id/publish', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const result = await pool.query(
			"UPDATE job_assessments SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
			[req.params.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Assessment not found' });
		}

		res.json({ assessment: result.rows[0] });
	} catch (error) {
		console.error('Error publishing assessment:', error);
		res.status(500).json({ error: 'Failed to publish assessment' });
	}
});

// Candidate: Start a job assessment attempt
router.post('/job-assessment/:id/start', authMiddleware, async (req, res) => {
	try {
		const assessmentId = req.params.id;
		const candidateId = req.user.id;
		const { applicationId } = req.body;

		// Check assessment exists and is published
		const assessment = await pool.query(
			"SELECT * FROM job_assessments WHERE id = $1 AND status = 'published'",
			[assessmentId],
		);
		if (assessment.rows.length === 0) {
			return res.status(404).json({ error: 'Assessment not found or not published' });
		}

		// Recruiters may preview any published assessment; candidates may only
		// start when they have an assigned (or in-progress) attempt (#343 task 2).
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		const isRecruiter = recruiterRoles.includes(req.user.role);

		// Check for existing active attempt
		let existing = await pool.query(
			"SELECT * FROM job_assessment_attempts WHERE assessment_id = $1 AND candidate_id = $2 AND status = 'in_progress'",
			[assessmentId, candidateId],
		);
		if (existing.rows.length === 0) {
			// Check for a recruiter-assigned attempt waiting to be started — adopt it
			// instead of creating a duplicate.
			const assigned = await pool.query(
				"SELECT * FROM job_assessment_attempts WHERE assessment_id = $1 AND candidate_id = $2 AND status = 'assigned' ORDER BY created_at DESC LIMIT 1",
				[assessmentId, candidateId],
			);
			if (assigned.rows.length > 0) {
				// Deadline: an assigned attempt past its due_date can't be started (#343 task 3).
				if (assigned.rows[0].due_date && new Date(assigned.rows[0].due_date) < new Date()) {
					return res.status(410).json({
						error: 'This assessment assignment has expired',
						code: 'ASSESSMENT_EXPIRED',
					});
				}
				await pool.query(
					`UPDATE job_assessment_attempts SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
					[assigned.rows[0].id],
				);
				existing = await pool.query(`SELECT * FROM job_assessment_attempts WHERE id = $1`, [
					assigned.rows[0].id,
				]);
			}
		}
		if (existing.rows.length > 0) {
			// Resume existing attempt
			const attempt = existing.rows[0];
			// Deadline: an in_progress attempt past its due_date can't continue (#343 task 3).
			if (attempt.due_date && new Date(attempt.due_date) < new Date()) {
				return res.status(410).json({
					error: 'This assessment assignment has expired',
					code: 'ASSESSMENT_EXPIRED',
				});
			}
			const answers =
				typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];
			const nextIndex = answers.length;

			const questions = await pool.query(
				'SELECT id, category, question_type, question_text, options, difficulty_level, points, time_limit_seconds, order_index FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
				[assessmentId],
			);

			const nextQ = questions.rows[nextIndex];
			const resumeEvents = parseJsonArray(attempt.integrity_events);
			return res.json({
				attemptId: attempt.id,
				resumed: true,
				progress: { current: nextIndex + 1, total: questions.rows.length },
				timeLimitMinutes: assessment.rows[0].time_limit_minutes || 45,
				startedAt: attempt.started_at,
				// Phase B (§7.3): resume restores the stored draft and the
				// full-screen exits already used for this attempt.
				currentDraft: parseDraft(attempt.current_draft),
				fullscreenExitsUsed: resumeEvents.filter((e) => e && e.type === 'fullscreen_exit_first').length,
				question: nextQ
					? {
							id: nextQ.id,
							category: nextQ.category,
							type: nextQ.question_type,
							text: nextQ.question_text,
							options:
								typeof nextQ.options === 'string' ? JSON.parse(nextQ.options) : nextQ.options,
							timeLimit: nextQ.time_limit_seconds,
							points: nextQ.points,
							difficulty: nextQ.difficulty_level,
						}
					: null,
			});
		}

		// Create new attempt — recruiter preview only. Candidates without an
		// assigned attempt cannot self-start (#343 task 2).
		if (!isRecruiter) {
			return res.status(403).json({
				error: 'No assessment assignment found for this candidate',
				code: 'ASSIGNMENT_REQUIRED',
			});
		}
		const attempt = await pool.query(
			`
      INSERT INTO job_assessment_attempts (assessment_id, candidate_id, application_id, status)
      VALUES ($1, $2, $3, 'in_progress')
      RETURNING *
    `,
			[assessmentId, candidateId, applicationId || null],
		);

		// Get first question
		const questions = await pool.query(
			'SELECT id, category, question_type, question_text, options, difficulty_level, points, time_limit_seconds FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index LIMIT 1',
			[assessmentId],
		);

		const firstQ = questions.rows[0];
		const totalCount = await pool.query(
			'SELECT COUNT(*) as total FROM job_assessment_questions WHERE assessment_id = $1',
			[assessmentId],
		);

		res.json({
			attemptId: attempt.rows[0].id,
			resumed: false,
			progress: { current: 1, total: parseInt(totalCount.rows[0].total, 10) },
			timeLimitMinutes: assessment.rows[0].time_limit_minutes || 45,
			startedAt: attempt.rows[0].started_at,
			question: firstQ
				? {
						id: firstQ.id,
						category: firstQ.category,
						type: firstQ.question_type,
						text: firstQ.question_text,
						options:
							typeof firstQ.options === 'string' ? JSON.parse(firstQ.options) : firstQ.options,
						timeLimit: firstQ.time_limit_seconds,
						points: firstQ.points,
						difficulty: firstQ.difficulty_level,
					}
				: null,
		});
	} catch (error) {
		console.error('Error starting job assessment:', error);
		res.status(500).json({ error: 'Failed to start assessment' });
	}
});

// Candidate: Submit answer and get next question (with adaptive difficulty)
router.post('/job-assessment/:id/answer', authMiddleware, async (req, res) => {
	const client = await pool.connect();
	try {
		const assessmentId = req.params.id;
		const candidateId = req.user.id;
		const { attemptId, questionId, answer, timeTaken } = req.body;

		await client.query('BEGIN');

		// Get attempt (join the assessment for its time_limit_minutes)
		const attemptResult = await client.query(
			`SELECT jaa.*, ja.time_limit_minutes
       FROM job_assessment_attempts jaa
       JOIN job_assessments ja ON ja.id = jaa.assessment_id
       WHERE jaa.id = $1 AND jaa.candidate_id = $2 AND jaa.status = 'in_progress'`,
			[attemptId, candidateId],
		);
		if (attemptResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Active attempt not found' });
		}
		const attempt = attemptResult.rows[0];

		// Deadline: reject answers on expired attempts (#343 task 3).
		if (attempt.due_date && new Date(attempt.due_date) < new Date()) {
			await client.query('ROLLBACK');
			return res.status(410).json({
				error: 'This assessment assignment has expired',
				code: 'ASSESSMENT_EXPIRED',
			});
		}

		// Overall time limit: started_at + time_limit_minutes (#343 task 3),
		// minus Phase B pause credit (§5.3): time the candidate spent in the
		// Exit dialog / full-screen warning does not consume the exam clock.
		const timeLimitMinutes = attempt.time_limit_minutes || 45;
		const pauseCredit = pauseCreditSeconds(parseJsonArray(attempt.integrity_events), Date.now());
		if (
			attempt.started_at &&
			Date.now() - new Date(attempt.started_at).getTime() - pauseCredit * 1000 >
				timeLimitMinutes * 60 * 1000
		) {
			await client.query('ROLLBACK');
			return res.status(410).json({
				error: 'The time limit for this assessment has elapsed',
				code: 'TIME_LIMIT_EXCEEDED',
			});
		}

		// Get question
		const qResult = await client.query(
			'SELECT * FROM job_assessment_questions WHERE id = $1 AND assessment_id = $2',
			[questionId, assessmentId],
		);
		if (qResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Question not found' });
		}
		const question = qResult.rows[0];

		// Quick-score multiple choice immediately
		let quickScore = null;
		let feedback = null;
		if (question.question_type === 'multiple_choice') {
			const isCorrect = answer === question.correct_answer;
			quickScore = isCorrect ? question.points : 0;
			feedback = isCorrect ? 'Correct!' : `Incorrect. ${question.explanation || ''}`;
		}

		// Check for time anomaly
		const minTime = question.question_type === 'multiple_choice' ? 3 : 10;
		const isTimeAnomaly = timeTaken && timeTaken < minTime;

		// Update answers
		const answers =
			typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];
		answers.push({
			questionId,
			answer,
			timeTaken: timeTaken || 0,
			quickScore,
			category: question.category,
			questionType: question.question_type,
			points: question.points,
			isTimeAnomaly,
			timestamp: new Date(),
		});

		// Adaptive difficulty: adjust based on performance in category
		const categoryAnswers = answers.filter((a) => a.category === question.category);
		const categoryCorrect = categoryAnswers.filter((a) => a.quickScore > 0).length;
		const categoryRate =
			categoryAnswers.length > 0 ? categoryCorrect / categoryAnswers.length : 0.5;
		let newDifficulty = attempt.current_difficulty || 3;
		if (categoryRate > 0.75 && newDifficulty < 5) newDifficulty++;
		else if (categoryRate < 0.4 && newDifficulty > 1) newDifficulty--;

		const newTimeAnomalies = (attempt.time_anomalies || 0) + (isTimeAnomaly ? 1 : 0);
		const newTimeSpent = (attempt.time_spent_seconds || 0) + (timeTaken || 0);

		await client.query(
			`
      UPDATE job_assessment_attempts
      SET answers = $1, current_question_index = $2, current_difficulty = $3,
          time_anomalies = $4, time_spent_seconds = $5,
          current_draft = CASE WHEN current_draft->>'questionId' = $7 THEN NULL ELSE current_draft END
      WHERE id = $6
    `,
			[
				JSON.stringify(answers),
				answers.length,
				newDifficulty,
				newTimeAnomalies,
				newTimeSpent,
				attemptId,
				// Phase B (§8.2): answering the drafted question clears its draft.
				String(questionId),
			],
		);

		// Get all questions to find next
		const allQuestions = await client.query(
			'SELECT id, category, question_type, question_text, options, difficulty_level, points, time_limit_seconds, order_index FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
			[assessmentId],
		);

		const totalQuestions = allQuestions.rows.length;
		const nextIndex = answers.length;

		if (nextIndex >= totalQuestions) {
			// Assessment complete — Phase B (§4.3): the SAME atomic
			// status-guarded claim as every other terminal path. The plain
			// UPDATE this replaces let two concurrent last-answers both
			// complete (and double-fire scoring). A lost claim means the
			// attempt already terminated via an exit action: the recorded
			// answers stand, scoring fires only for the claim winner.
			const claimRes = await client.query(
				`UPDATE job_assessment_attempts
				 SET status = 'completed', completed_at = NOW(), current_draft = NULL,
				     completion_flags = COALESCE(completion_flags, '{}'::jsonb) || $2::jsonb
				 WHERE id = $1 AND status = 'in_progress'
				 RETURNING id`,
				[
					attemptId,
					JSON.stringify({
						partial: false,
						answers_given: answers.length,
						total_questions: totalQuestions,
					}),
				],
			);
			await client.query('COMMIT');

			if (claimRes.rows.length === 0) {
				return res.status(409).json({
					error: 'This attempt is already finished',
					code: 'ALREADY_FINISHED',
				});
			}

			// Trigger async scoring (don't wait) — exactly once, post-commit.
			scoreAttempt(attemptId, assessmentId).catch((err) =>
				console.error('[scoring] Async scoring failed:', err.message),
			);

			return res.json({
				completed: true,
				feedback,
				progress: { current: totalQuestions, total: totalQuestions },
			});
		}

		const nextQ = allQuestions.rows[nextIndex];
		await client.query('COMMIT');

		res.json({
			completed: false,
			feedback,
			quickScore,
			progress: { current: nextIndex + 1, total: totalQuestions },
			nextQuestion: nextQ
				? {
						id: nextQ.id,
						category: nextQ.category,
						type: nextQ.question_type,
						text: nextQ.question_text,
						options: typeof nextQ.options === 'string' ? JSON.parse(nextQ.options) : nextQ.options,
						timeLimit: nextQ.time_limit_seconds,
						points: nextQ.points,
						difficulty: nextQ.difficulty_level,
					}
				: null,
		});
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Error submitting job assessment answer:', error);
		res.status(500).json({ error: 'Failed to submit answer' });
	} finally {
		client.release();
	}
});

// Score an assessment attempt using AI
async function scoreAttempt(attemptId, assessmentId) {
	try {
		const attempt = await pool.query('SELECT * FROM job_assessment_attempts WHERE id = $1', [
			attemptId,
		]);
		if (attempt.rows.length === 0) return;
		const att = attempt.rows[0];

		// Idempotency (I1): never re-score an already-scored attempt — the
		// async path (candidate's last answer) and POST /score can both fire
		// on the same attempt, and a re-run would double-notify. A failed
		// scoring run leaves scored_at NULL, so retries still work.
		if (att.scored_at) return;

		// Phase B: an abandoned attempt is NEVER scored (Exit Exam writes no
		// score — composite stays NULL, no evaluation, no OmniScore). The
		// partial flag is read from the row the submit claim committed, so
		// the decision cannot diverge from the claim (database-reviewer).
		if (att.status === 'abandoned') return;
		const attemptFlags = parseJsonObject(att.completion_flags);
		const isPartialAttempt = attemptFlags.partial === true;

		const answers = typeof att.answers === 'string' ? JSON.parse(att.answers) : att.answers || [];
		if (answers.length === 0) {
			// Fix round F4: a completed PARTIAL attempt with zero answers
			// has nothing to score — but it must not vanish. Record the
			// terminal unscored state in `scores` (composite stays NULL,
			// scored_at stays NULL: no score was ever produced, and no
			// surface may render one). The candidate score view derives
			// `unscored` from this state and stops polling; the recruiter
			// lists show the attempt as submitted-with-no-answers.
			if (att.status === 'completed' && isPartialAttempt) {
				await pool.query(
					`UPDATE job_assessment_attempts SET scores = $1 WHERE id = $2 AND scored_at IS NULL`,
					[
						JSON.stringify({
							earnedPoints: 0,
							totalPoints: 0,
							compositeScore: null,
							partial: true,
							answers_given: 0,
							total_questions: attemptFlags.total_questions ?? null,
							unscored: true,
							unscored_reason: 'no_answers',
						}),
						attemptId,
					],
				);
			}
			return;
		}

		// Get all questions
		const questions = await pool.query(
			'SELECT * FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
			[assessmentId],
		);
		const qMap = {};
		for (const q of questions.rows) qMap[q.id] = q;

		// Group answers by category
		const categoryGroups = {};
		let totalPoints = 0;
		let earnedPoints = 0;

		for (const ans of answers) {
			const q = qMap[ans.questionId];
			if (!q) continue;

			if (!categoryGroups[q.category]) {
				categoryGroups[q.category] = { questions: [], totalPoints: 0, earnedPoints: 0 };
			}

			totalPoints += q.points;

			if (q.question_type === 'multiple_choice') {
				// Already scored
				const pts = ans.quickScore || 0;
				earnedPoints += pts;
				categoryGroups[q.category].earnedPoints += pts;
				categoryGroups[q.category].totalPoints += q.points;
				categoryGroups[q.category].questions.push({
					text: q.question_text,
					answer: ans.answer,
					score: pts,
					maxPoints: q.points,
					type: 'multiple_choice',
				});
			} else {
				// AI-score free text / scenario / code challenge
				const scorePrompt = `Score this assessment answer.

QUESTION (${q.category}, ${q.question_type}): ${q.question_text}
${q.rubric ? `RUBRIC: ${q.rubric}` : ''}
${q.correct_answer ? `EXPECTED: ${q.correct_answer}` : ''}
MAX POINTS: ${q.points}

CANDIDATE'S ANSWER: ${ans.answer}

Score on three dimensions:
- Relevance: Does it address the question? (0-100)
- Depth: How thorough and insightful? (0-100)
- Accuracy: Is the information correct? (0-100)

Return ONLY valid JSON:
{
  "relevance": 0-100,
  "depth": 0-100,
  "accuracy": 0-100,
  "score": 0-${q.points},
  "feedback": "2-3 sentence explanation of the score",
  "strengths": ["strength 1"],
  "weaknesses": ["weakness 1"]
}`;

				try {
					const scoreResponse = await chat(scorePrompt, {
						maxTokens: 512,
						module: 'assessments',
						feature: 'ai_scoring',
					});
					const scoreData = safeParseJSON(scoreResponse);
					if (scoreData) {
						const pts = Math.min(q.points, Math.max(0, scoreData.score || 0));
						earnedPoints += pts;
						categoryGroups[q.category].earnedPoints += pts;
						categoryGroups[q.category].totalPoints += q.points;
						categoryGroups[q.category].questions.push({
							text: q.question_text,
							answer: ans.answer,
							score: pts,
							maxPoints: q.points,
							type: q.question_type,
							aiScore: scoreData,
						});
						// Store score back in answers
						ans.aiScore = scoreData;
						ans.quickScore = pts;
					}
				} catch (err) {
					console.error(`[scoring] Failed to score Q${q.id}:`, err.message);
					categoryGroups[q.category].totalPoints += q.points;
					categoryGroups[q.category].questions.push({
						text: q.question_text,
						answer: ans.answer,
						score: 0,
						maxPoints: q.points,
						type: q.question_type,
					});
				}
			}
		}

		// Calculate composite and category scores
		const compositeScore =
			totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100 * 10) / 10 : 0;
		const categoryScores = {};
		for (const [cat, data] of Object.entries(categoryGroups)) {
			categoryScores[cat] = {
				score:
					data.totalPoints > 0
						? Math.round((data.earnedPoints / data.totalPoints) * 100 * 10) / 10
						: 0,
				earned: data.earnedPoints,
				total: data.totalPoints,
				questionCount: data.questions.length,
			};
		}

		// Generate AI summary for recruiter
		const summaryPrompt = `You are a senior recruiter reviewing assessment results for a candidate.

COMPOSITE SCORE: ${compositeScore}%
CATEGORY BREAKDOWN:
${Object.entries(categoryScores)
	.map(([cat, s]) => `- ${cat}: ${s.score}% (${s.earned}/${s.total} points)`)
	.join('\n')}

DETAILED RESULTS:
${Object.entries(categoryGroups)
	.map(([cat, data]) =>
		data.questions
			.map(
				(q) =>
					`[${cat}] Q: ${q.text.substring(0, 100)}... → Score: ${q.score}/${q.maxPoints}${q.aiScore ? ` | ${q.aiScore.feedback || ''}` : ''}`,
			)
			.join('\n'),
	)
	.join('\n')}

Provide a recruiter-facing assessment summary.

Return ONLY valid JSON:
{
  "recommendation": "strong_hire|hire|maybe|no_hire",
  "summary": "2-3 sentence overall assessment",
  "strengths": ["Top strength 1", "Top strength 2", "Top strength 3"],
  "weaknesses": ["Area of concern 1", "Area of concern 2"],
  "fit_notes": "1-2 sentences about role fit",
  "suggested_interview_focus": ["Topic to probe in interview 1", "Topic 2"]
}`;

		let aiSummary = null;
		try {
			const summaryResponse = await chat(summaryPrompt, {
				maxTokens: 1024,
				module: 'assessments',
				feature: 'recruiter_summary',
			});
			aiSummary = safeParseJSON(summaryResponse);
		} catch (err) {
			console.error('[scoring] Summary generation failed:', err.message);
		}

		// Calculate anti-cheat score
		let antiCheatScore = 100;
		antiCheatScore -= (att.tab_switches || 0) * 3;
		antiCheatScore -= (att.copy_paste_attempts || 0) * 8;
		antiCheatScore -= (att.time_anomalies || 0) * 5;
		antiCheatScore = Math.max(0, antiCheatScore);

		// Save scores. The composite is computed over ANSWERED questions
		// only (totalPoints accumulates answered questions' points), and a
		// partial attempt carries its label in the scores payload too.
		await pool.query(
			`
      UPDATE job_assessment_attempts
      SET answers = $1, scores = $2, composite_score = $3, category_scores = $4,
          ai_summary = $5, anti_cheat_score = $6, scored_at = NOW()
      WHERE id = $7
    `,
			[
				JSON.stringify(answers),
				JSON.stringify({
					earnedPoints,
					totalPoints,
					compositeScore,
					...(isPartialAttempt
						? {
								partial: true,
								answers_given: attemptFlags.answers_given ?? answers.length,
								total_questions: attemptFlags.total_questions ?? questions.rows.length,
							}
						: {}),
				}),
				compositeScore,
				JSON.stringify(categoryScores),
				JSON.stringify(aiSummary),
				antiCheatScore,
				attemptId,
			],
		);

		console.log(
			`[scoring] Attempt ${attemptId} scored: ${compositeScore}% (${earnedPoints}/${totalPoints} pts)${isPartialAttempt ? ' [partial]' : ''}`,
		);

		// FOUNDER RULING (Phase B): a partial terminal submission is NOT
		// eligible for pass and does NOT feed OmniScore — so no application
		// round-trip (which writes pass/fail and can advance the stage) and
		// no OmniScore recalculation for partial attempts.
		if (!isPartialAttempt) {
			// Round-trip the result to the linked application: score write,
			// conservative stage advance on pass, recruiter notification (#343 task 4).
			// Non-blocking — failures are logged inside, never thrown.
			await roundTripAssessmentResult(att, assessmentId, compositeScore);

			// Feed the job assessment into OmniScore verified_skills (2x weight).
			// Non-blocking — same pattern as skill assessments (line ~904).
			if (att.candidate_id) {
				try {
					await omniscoreService.calculateScore(att.candidate_id);
					console.log(
						`[OmniScore] Job assessment ${attemptId} fed into OmniScore for user ${att.candidate_id} (score: ${compositeScore})`,
					);
				} catch (err) {
					console.error('[OmniScore] Failed to update from job assessment:', err.message);
				}
			}
		}
	} catch (error) {
		console.error('[scoring] Failed to score attempt:', error);
	}
}

// Round-trip a scored job assessment to its linked application (#343 task 4).
// Called at the end of scoreAttempt so BOTH the async path (candidate's last
// answer) and the manual POST /job-assessment/:id/score path are covered.
//
// What it does:
//  1. Writes assessment_score + assessment_result ('pass'/'fail') to
//     job_applications (migration 233).
//  2. On pass, advances a 'screening' application to 'shortlisted'. A fail is
//     marked but never auto-rejects — signals, not verdicts. Applications in
//     any other stage keep their stage and only record the score.
//  3. Fires the 'assessment_completed' in-app notification to the recruiter.
//
// Conservative by design: the stage only moves out of 'screening', and every
// step is guarded (missing application, missing recruiter). Non-blocking —
// failures are logged, never thrown; the attempt is already scored.
async function roundTripAssessmentResult(att, assessmentId, compositeScore) {
	if (!att?.application_id || att.status !== 'completed') return;
	try {
		const aRes = await pool.query('SELECT passing_score FROM job_assessments WHERE id = $1', [
			assessmentId,
		]);
		const passingScore = aRes.rows[0]?.passing_score ?? 70;
		const passed = compositeScore >= passingScore;
		const result = passed ? 'pass' : 'fail';

		const appRes = await pool.query('SELECT id, status FROM job_applications WHERE id = $1', [
			att.application_id,
		]);
		if (appRes.rows.length === 0) return;

		const advancedToShortlisted = ['applied', 'screening'].includes(appRes.rows[0].status) && passed;
		if (advancedToShortlisted) {
			await pool.query(
				`UPDATE job_applications SET status = 'shortlisted', assessment_score = $1, assessment_result = $2, updated_at = NOW() WHERE id = $3`,
				[compositeScore, result, att.application_id],
			);
		} else {
			await pool.query(
				`UPDATE job_applications SET assessment_score = $1, assessment_result = $2, updated_at = NOW() WHERE id = $3`,
				[compositeScore, result, att.application_id],
			);
		}

		const appInfo = await pool.query(
			`SELECT ja.job_id, j.user_id as recruiter_id, j.title as job_title, u.name as candidate_name
       FROM job_applications ja JOIN jobs j ON j.id = ja.job_id JOIN users u ON u.id = ja.candidate_id
       WHERE ja.id = $1`,
			[att.application_id],
		);
		const info = appInfo.rows[0];
		if (info?.recruiter_id) {
			await notifyUser(
				info.recruiter_id,
				'assessment_completed',
				'Assessment completed',
				`${info.candidate_name} completed the assessment for ${info.job_title} — score ${compositeScore ?? 'N/A'}.`,
				{
					attempt_id: att.id,
					assessment_id: assessmentId,
					application_id: att.application_id,
					job_id: info.job_id,
					composite_score: compositeScore,
				},
			);
		}
		// Transparency: the candidate sees their own score, not just the recruiter.
		// Non-blocking — notifyUser never throws, and scoring must not fail on notify.
		if (att.candidate_id) {
			await notifyUser(
				att.candidate_id,
				'assessment_scored',
				'Assessment scored',
				`Your assessment for ${info?.job_title ?? 'the role'} was scored: ${compositeScore ?? 'N/A'}/100 (${result}).`,
				{
					attempt_id: att.id,
					assessment_id: assessmentId,
					application_id: att.application_id,
					job_id: info?.job_id,
					composite_score: compositeScore,
					assessment_result: result,
					url: `/candidate/applications`,
				},
			);
		}
		// Transparency: a silent stage move is a black box — tell the candidate.
		if (advancedToShortlisted && att.candidate_id) {
			await notifyUser(
				att.candidate_id,
				'application_shortlisted',
				"You've been shortlisted",
				`Great news — your assessment score moved you to the shortlist for ${info?.job_title ?? 'the role'}. The hiring team will be in touch with next steps.`,
				{
					application_id: att.application_id,
					job_id: info?.job_id,
					composite_score: compositeScore,
					url: `/candidate/applications`,
				},
			);
		}
	} catch (err) {
		console.error('[scoring] Round-trip to application failed:', err.message);
	}
}

// Manually trigger scoring for an attempt
router.post('/job-assessment/:id/score', authMiddleware, async (req, res) => {
	try {
		const { attemptId } = req.body;
		const assessmentId = req.params.id;

		if (!attemptId) return res.status(400).json({ error: 'attemptId required' });

		// Verify access
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		const isRecruiter = recruiterRoles.includes(req.user.role);
		const isCandidate = !isRecruiter;

		if (isCandidate) {
			const check = await pool.query(
				'SELECT id FROM job_assessment_attempts WHERE id = $1 AND candidate_id = $2',
				[attemptId, req.user.id],
			);
			if (check.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
		}

		await scoreAttempt(attemptId, assessmentId);

		const result = await pool.query('SELECT * FROM job_assessment_attempts WHERE id = $1', [
			attemptId,
		]);

		// Fix round F1 (same leak, second surface): this response returns
		// the raw attempt row to recruiters too — the candidate's draft is
		// owner-only and is stripped before it leaves.
		const attemptOut = result.rows[0] || null;
		if (attemptOut) delete attemptOut.current_draft;
		res.json({ attempt: attemptOut });
	} catch (error) {
		console.error('Error scoring assessment:', error);
		res.status(500).json({ error: 'Failed to score assessment' });
	}
});

// Get assessment results
router.get('/job-assessment/:id/results', authMiddleware, async (req, res) => {
	try {
		const assessmentId = req.params.id;
		const { attemptId, candidateId } = req.query;

		// Fix round F1: explicit column list — NEVER ja.*. Migration 276
		// added job_assessment_attempts.current_draft (the candidate's
		// stored-but-not-answered draft, design §8.2: owner-only, never
		// recruiter-visible); a wildcard select leaks it to every caller
		// of this endpoint, recruiters included. current_draft is the one
		// column deliberately absent below; every other attempt field is
		// scoring/results data this endpoint exists to serve.
		let query =
			'SELECT ja.id, ja.assessment_id, ja.candidate_id, ja.application_id, ja.status, ja.current_question_index, ja.current_difficulty, ja.answers, ja.scores, ja.composite_score, ja.category_scores, ja.ai_summary, ja.time_spent_seconds, ja.tab_switches, ja.copy_paste_attempts, ja.time_anomalies, ja.anti_cheat_score, ja.started_at, ja.completed_at, ja.scored_at, ja.created_at, ja.due_date, ja.abandoned_at, ja.completion_flags, ja.integrity_events, u.name as candidate_name, u.email as candidate_email FROM job_assessment_attempts ja LEFT JOIN users u ON ja.candidate_id = u.id WHERE ja.assessment_id = $1';
		const params = [assessmentId];

		if (attemptId) {
			query += ' AND ja.id = $2';
			params.push(attemptId);
		} else if (candidateId) {
			query += ' AND ja.candidate_id = $2';
			params.push(candidateId);
		} else {
			// If candidate, show only their own
			const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
			if (!recruiterRoles.includes(req.user.role)) {
				query += ' AND ja.candidate_id = $2';
				params.push(req.user.id);
			}
		}

		query += ' ORDER BY ja.created_at DESC';

		const results = await pool.query(query, params);

		// Get the assessment details too
		const assessment = await pool.query(
			'SELECT title, description, question_count, categories, passing_score FROM job_assessments WHERE id = $1',
			[assessmentId],
		);

		// Audit: track result views for TrustScore assessment_responsiveness (non-blocking)
		try {
			await AuditLogger.log({
				actionType: 'assessment_result.viewed',
				userId: req.user.id,
				targetType: 'job_assessment',
				targetId: parseInt(assessmentId, 10),
				metadata: {
					attempt_id: attemptId || null,
					candidate_id: candidateId || null,
					viewer_role: req.user.role,
				},
				req,
			});
		} catch (auditErr) {
			console.error('Assessment view audit failed (non-blocking):', auditErr.message);
		}

		res.json({
			assessment: assessment.rows[0] || null,
			attempts: results.rows,
		});
	} catch (error) {
		console.error('Error fetching assessment results:', error);
		res.status(500).json({ error: 'Failed to fetch results' });
	}
});

// Recruiter: Get all job assessment results across all jobs
router.get('/job-assessments/all', authMiddleware, async (req, res) => {
	try {
		const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const result = await pool.query(`
      SELECT jaa.id, jaa.composite_score, jaa.category_scores, jaa.ai_summary,
             jaa.anti_cheat_score, jaa.status, jaa.completed_at, jaa.scored_at,
             jaa.time_spent_seconds,
             ja.title as assessment_title, ja.job_id,
             j.title as job_title, j.company,
             u.name as candidate_name, u.email as candidate_email, u.id as candidate_id
      FROM job_assessment_attempts jaa
      JOIN job_assessments ja ON jaa.assessment_id = ja.id
      LEFT JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN users u ON jaa.candidate_id = u.id
      WHERE jaa.scored_at IS NOT NULL
      ORDER BY jaa.scored_at DESC
      LIMIT 100
    `);

		res.json({ results: result.rows });
	} catch (error) {
		console.error('Error fetching all job assessment results:', error);
		res.status(500).json({ error: 'Failed to fetch results' });
	}
});

// Conversational assessment — AI asks follow-up questions based on answers (RATE LIMITED)
router.post('/job-assessment/:id/converse', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const assessmentId = req.params.id;
		const candidateId = req.user.id;
		const { attemptId, questionId, message } = req.body;

		if (!attemptId || !message) {
			return res.status(400).json({ error: 'attemptId and message required' });
		}

		// Ownership: only the attempt owner may converse on it (IDOR fix, #343 I2).
		const attemptResult = await pool.query(
			`SELECT jaa.*, ja.time_limit_minutes
       FROM job_assessment_attempts jaa
       JOIN job_assessments ja ON ja.id = jaa.assessment_id
       WHERE jaa.id = $1 AND jaa.candidate_id = $2 AND jaa.status = 'in_progress'`,
			[attemptId, candidateId],
		);
		if (attemptResult.rows.length === 0) {
			return res.status(404).json({ error: 'Active attempt not found' });
		}
		const attempt = attemptResult.rows[0];

		// Deadline: reject converse on expired attempts (#343 I1).
		if (attempt.due_date && new Date(attempt.due_date) < new Date()) {
			return res.status(410).json({
				error: 'This assessment assignment has expired',
				code: 'ASSESSMENT_EXPIRED',
			});
		}

		// Overall time limit: started_at + time_limit_minutes (#343 I1),
		// minus the same Phase B pause credit as /answer (§5.3).
		const timeLimitMinutes = attempt.time_limit_minutes || 45;
		const conversePauseCredit = pauseCreditSeconds(parseJsonArray(attempt.integrity_events), Date.now());
		if (
			attempt.started_at &&
			Date.now() - new Date(attempt.started_at).getTime() - conversePauseCredit * 1000 >
				timeLimitMinutes * 60 * 1000
		) {
			return res.status(410).json({
				error: 'The time limit for this assessment has elapsed',
				code: 'TIME_LIMIT_EXCEEDED',
			});
		}

		// Get the question context
		const qResult = await pool.query(
			'SELECT * FROM job_assessment_questions WHERE id = $1 AND assessment_id = $2',
			[questionId, assessmentId],
		);
		if (qResult.rows.length === 0) {
			return res.status(404).json({ error: 'Question not found' });
		}
		const question = qResult.rows[0];

		// Get conversation history for this question
		const history = await pool.query(
			'SELECT role, message FROM assessment_conversations WHERE attempt_id = $1 AND question_id = $2 ORDER BY created_at',
			[attemptId, questionId],
		);

		const convoHistory = history.rows.map((h) => `${h.role}: ${h.message}`).join('\n');

		// Save candidate's message
		await pool.query(
			'INSERT INTO assessment_conversations (attempt_id, question_id, role, message) VALUES ($1, $2, $3, $4)',
			[attemptId, questionId, 'candidate', message],
		);

		// Limit to 3 follow-ups per question
		const aiTurns = history.rows.filter((h) => h.role === 'ai').length;
		if (aiTurns >= 3) {
			return res.json({
				reply: "Thank you for your thorough response. Let's move on to the next question.",
				done: true,
				followUpCount: aiTurns,
			});
		}

		// AI generates follow-up
		const prompt = `You are conducting a skill assessment conversation. Based on the candidate's answer, ask ONE probing follow-up question to assess their depth of understanding.

ASSESSMENT QUESTION: ${question.question_text}
${question.rubric ? `RUBRIC: ${question.rubric}` : ''}

CONVERSATION SO FAR:
${convoHistory}
candidate: ${message}

Rules:
- Ask ONE specific follow-up that probes deeper
- If they gave a surface-level answer, ask for specifics
- If they mentioned an interesting approach, ask them to elaborate
- If they seem to have fully answered, say so and indicate you're satisfied
- Keep it conversational and professional

Return ONLY valid JSON:
{
  "reply": "Your follow-up question or acknowledgment",
  "satisfied": true/false,
  "depth_score": 1-10,
  "notes": "Brief assessment note"
}`;

		const response = await chat(prompt, {
			maxTokens: 512,
			module: 'assessments',
			feature: 'conversational',
		});
		const parsed = safeParseJSON(response);

		const reply = parsed?.reply || 'Could you elaborate on your approach?';
		const satisfied = parsed?.satisfied || false;

		// Save AI reply
		await pool.query(
			'INSERT INTO assessment_conversations (attempt_id, question_id, role, message, metadata) VALUES ($1, $2, $3, $4, $5)',
			[
				attemptId,
				questionId,
				'ai',
				reply,
				JSON.stringify({ satisfied, depth_score: parsed?.depth_score, notes: parsed?.notes }),
			],
		);

		res.json({
			reply,
			done: satisfied,
			followUpCount: aiTurns + 1,
		});
	} catch (error) {
		console.error('Error in conversational assessment:', error);
		res.status(500).json({ error: 'Failed to generate follow-up' });
	}
});

// Anti-cheat event logging for job assessments
// Phase B (design §7): the event vocabulary shared by both runners.
// On the JOB runner every type below is actually RECORDED (persisted into
// integrity_events with a server receipt timestamp) — {logged:true} is
// returned ONLY for a recorded type; an unrecognised type is a 400, so a
// client bug can never masquerade as a logged event again (this endpoint
// previously dropped every type except tab_switch/copy_paste while still
// returning {logged:true}).
const JOB_EVENT_TYPES = new Set([
	'tab_switch',
	'copy_paste',
	'fullscreen_entered',
	'fullscreen_unavailable',
	'fullscreen_opt_out',
	'fullscreen_exit_first',
	'fullscreen_exit_repeat',
	'fullscreen_exit_second',
	'exit_dialog_opened',
	'exit_dialog_timeout_resume',
	'exit_save',
	'exit_submit',
	'exit_exam',
	'timer_pause_start',
	'timer_pause_end',
]);

router.post('/job-assessment/:id/event', authMiddleware, async (req, res) => {
	try {
		const { attemptId, eventType, eventData } = req.body;
		if (!attemptId || !eventType)
			return res.status(400).json({ error: 'attemptId and eventType required' });
		if (!JOB_EVENT_TYPES.has(eventType)) {
			return res.status(400).json({ error: 'Unknown event type', code: 'UNKNOWN_EVENT_TYPE' });
		}

		// Single ownership+status-guarded append (database-reviewer
		// condition): rowcount 0 means the attempt is not the caller's
		// in-progress attempt — 404, and nothing was recorded.
		const event = {
			type: eventType,
			timestamp: new Date().toISOString(),
			data: eventData && typeof eventData === 'object' ? eventData : {},
		};
		const appended = await pool.query(
			`UPDATE job_assessment_attempts
			 SET integrity_events = COALESCE(integrity_events, '[]'::jsonb) || $1::jsonb
			 WHERE id = $2 AND candidate_id = $3 AND status = 'in_progress'`,
			[JSON.stringify([event]), attemptId, req.user.id],
		);
		if (appended.rowCount === 0) {
			return res.status(404).json({ error: 'Active attempt not found' });
		}

		// The two legacy counters keep working alongside the event store.
		if (eventType === 'tab_switch') {
			await pool.query(
				'UPDATE job_assessment_attempts SET tab_switches = COALESCE(tab_switches, 0) + 1 WHERE id = $1 AND candidate_id = $2',
				[attemptId, req.user.id],
			);
		} else if (eventType === 'copy_paste') {
			await pool.query(
				'UPDATE job_assessment_attempts SET copy_paste_attempts = COALESCE(copy_paste_attempts, 0) + 1 WHERE id = $1 AND candidate_id = $2',
				[attemptId, req.user.id],
			);
		}

		res.json({ logged: true });
	} catch (error) {
		console.error('Error logging assessment event:', error);
		res.status(500).json({ error: 'Failed to log event' });
	}
});

// Phase B (#1604/#1605, design §3.3/§4.2): the job runner's exit endpoint —
// the same four-outcome contract as the skill runner's. Submit mirrors
// completeAssessmentTx exactly (claim + flags in ONE transaction, COMMIT,
// then scoreAttempt exactly once); abandon is the mirror claim to
// 'abandoned' (a status value this table has always allowed and no code
// path wrote before Phase B) and never invokes scoring.
router.post('/job-assessment/:id/exit', authMiddleware, async (req, res) => {
	try {
		const assessmentId = req.params.id;
		const candidateId = req.user.id;
		const { attemptId, action, draft, reason } = req.body || {};
		if (!attemptId) return res.status(400).json({ error: 'attemptId required' });
		if (!['save', 'submit', 'abandon'].includes(action)) {
			return res.status(400).json({ error: 'Invalid exit action', code: 'INVALID_ACTION' });
		}
		const exitReason = reason === 'fullscreen_second_exit' ? 'fullscreen_second_exit' : 'candidate';

		// Fix round F5: ownership, the due-date check, and the
		// partial/answers snapshot are ALL taken inside the claim
		// transaction, from the FOR UPDATE-locked attempt row — never
		// from a non-transactional pre-read — and every claim UPDATE
		// carries the ownership guard and has its rowcount checked. A
		// concurrent /answer can no longer make the committed flags
		// disagree with the answers actually scored, and a claim that
		// loses its race answers 409 instead of a false 200.
		const client = await pool.connect();
		let submitOutcome = null;
		try {
			await client.query('BEGIN');
			const locked = await client.query(
				'SELECT * FROM job_assessment_attempts WHERE id = $1 AND candidate_id = $2 AND assessment_id = $3 FOR UPDATE',
				[attemptId, candidateId, assessmentId],
			);
			if (locked.rows.length === 0) {
				await client.query('ROLLBACK');
				return res.status(404).json({ error: 'Attempt not found' });
			}
			const attempt = locked.rows[0];
			if (attempt.status !== 'in_progress') {
				await client.query('ROLLBACK');
				return res.status(409).json({
					error: 'This attempt is already finished',
					code: 'ALREADY_FINISHED',
					status: attempt.status,
				});
			}
			const answers = parseJsonArray(attempt.answers);
			const totalResult = await client.query(
				'SELECT COUNT(*)::int AS n FROM job_assessment_questions WHERE assessment_id = $1',
				[assessmentId],
			);
			const totalQuestions = totalResult.rows[0].n;

			// Due-date interaction (§4.2): Save & Exit is refused past the
			// due date (nothing resumable remains); the two terminal
			// outcomes stay allowed so the attempt is never stranded.
			if (action === 'save' && attempt.due_date && new Date(attempt.due_date) < new Date()) {
				await client.query('ROLLBACK');
				return res.status(410).json({
					error: 'This assessment assignment has expired',
					code: 'ASSESSMENT_EXPIRED',
				});
			}

			if (action === 'save') {
				let storedDraft = null;
				if (draft != null) {
					const qid = Number(draft.questionId);
					if (!Number.isInteger(qid) || typeof draft.answer !== 'string') {
						await client.query('ROLLBACK');
						return res.status(400).json({ error: 'Invalid draft', code: 'INVALID_DRAFT' });
					}
					const qCheck = await client.query(
						'SELECT id FROM job_assessment_questions WHERE id = $1 AND assessment_id = $2',
						[qid, assessmentId],
					);
					if (qCheck.rows.length === 0) {
						await client.query('ROLLBACK');
						return res.status(400).json({
							error: 'That question is not part of this assessment',
							code: 'QUESTION_NOT_CURRENT',
						});
					}
					storedDraft = { questionId: qid, answer: draft.answer, savedAt: new Date().toISOString() };
				}
				const claim = await client.query(
					`UPDATE job_assessment_attempts
					 SET current_draft = $1,
					     integrity_events = COALESCE(integrity_events, '[]'::jsonb) || $2::jsonb
					 WHERE id = $3 AND candidate_id = $4 AND status = 'in_progress'
					 RETURNING id`,
					[
						storedDraft ? JSON.stringify(storedDraft) : null,
						JSON.stringify([
							{ type: 'exit_save', timestamp: new Date().toISOString(), data: { answersGiven: answers.length } },
						]),
						attemptId,
						candidateId,
					],
				);
				if (claim.rows.length === 0) {
					await client.query('ROLLBACK');
					return res.status(409).json({
						error: 'This attempt is already finished',
						code: 'ALREADY_FINISHED',
					});
				}
				await client.query('COMMIT');
				return res.json({ status: 'in_progress', answersGiven: answers.length, totalQuestions });
			}

			if (action === 'abandon') {
				const abandonEvent = {
					type: 'exit_exam',
					timestamp: new Date().toISOString(),
					data: { answersGiven: answers.length, reason: exitReason },
				};
				const claim = await client.query(
					`UPDATE job_assessment_attempts
					 SET status = 'abandoned', abandoned_at = NOW(), current_draft = NULL,
					     integrity_events = COALESCE(integrity_events, '[]'::jsonb) || $2::jsonb
					 WHERE id = $1 AND candidate_id = $3 AND status = 'in_progress'
					 RETURNING id`,
					[attemptId, JSON.stringify([abandonEvent]), candidateId],
				);
				if (claim.rows.length === 0) {
					await client.query('ROLLBACK');
					return res.status(409).json({
						error: 'This attempt is already finished',
						code: 'ALREADY_FINISHED',
					});
				}
				await client.query('COMMIT');
				// composite_score stays NULL, scored_at stays NULL,
				// scoreAttempt is never called: no score, anywhere.
				return res.json({ status: 'abandoned', answersGiven: answers.length, totalQuestions });
			}

			// action === 'submit' — claim + flags in the same transaction,
			// computed from the locked row; scoring fires post-commit.
			const isPartial = answers.length < totalQuestions;
			const flags = {
				partial: isPartial,
				answers_given: answers.length,
				total_questions: totalQuestions,
				fullscreen_auto_submit: exitReason === 'fullscreen_second_exit',
			};
			const claim = await client.query(
				`UPDATE job_assessment_attempts
				 SET status = 'completed', completed_at = NOW(), current_draft = NULL,
				     completion_flags = COALESCE(completion_flags, '{}'::jsonb) || $2::jsonb,
				     integrity_events = COALESCE(integrity_events, '[]'::jsonb) || $3::jsonb
				 WHERE id = $1 AND candidate_id = $4 AND status = 'in_progress'
				 RETURNING id`,
				[
					attemptId,
					JSON.stringify(flags),
					JSON.stringify([
						{
							type: 'exit_submit',
							timestamp: new Date().toISOString(),
							data: { answersGiven: answers.length, reason: exitReason, partial: isPartial },
						},
					]),
					candidateId,
				],
			);
			if (claim.rows.length === 0) {
				await client.query('ROLLBACK');
				return res.status(409).json({
					error: 'This attempt is already finished',
					code: 'ALREADY_FINISHED',
				});
			}
			await client.query('COMMIT');
			submitOutcome = { answersGiven: answers.length, totalQuestions, isPartial };
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
		// Exactly once, post-commit — the same contract as the last-answer path.
		scoreAttempt(attemptId, assessmentId).catch((err) =>
			console.error('[scoring] Async scoring failed:', err.message),
		);
		return res.json({
			status: 'completed',
			answersGiven: submitOutcome.answersGiven,
			totalQuestions: submitOutcome.totalQuestions,
			partial: submitOutcome.isPartial,
			fullscreenAutoSubmit: exitReason === 'fullscreen_second_exit',
			...(draft != null ? { draftExcluded: true } : {}),
		});
	} catch (error) {
		console.error('Error processing job assessment exit:', error);
		res.status(500).json({ error: 'Failed to exit assessment' });
	}
});

module.exports = router;
