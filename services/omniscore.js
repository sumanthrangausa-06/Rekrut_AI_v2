// OmniScore Service v2 — 8-Factor Deep Scoring with Explainability
// Issue #113
// Deterministic, reproducible, and fraud-aware candidate scoring.

const pool = require('../lib/db');

// #1776: named scoring-semantics version bump (panel ruling on #1761,
// Option D). Reliability raw is measured-only from this version on —
// no neutral base, no default attendance/follow-through rates. Rows and
// snapshots written under earlier semantics keep their stored values;
// they are not reinterpreted, only new computations use this version.
const SCORING_SEMANTICS_VERSION = 'v3-reliability-measured-only';

// ─── Score ranges and tiers ─────────────────────────────────
const SCORE_RANGES = {
	MIN: 300,
	MAX: 850,
	TIERS: {
		exceptional: { min: 800, max: 850, label: 'Exceptional' },
		excellent: { min: 740, max: 799, label: 'Excellent' },
		good: { min: 670, max: 739, label: 'Good' },
		fair: { min: 580, max: 669, label: 'Fair' },
		needs_work: { min: 300, max: 579, label: 'Needs Work' },
	},
};

// ─── 8-Factor Weights (must sum to 1.0) ─────────────────────
const FACTOR_WEIGHTS = {
	verified_skills: 0.25,
	interview_performance: 0.2,
	experience_quality: 0.15,
	education_credentials: 0.1,
	reliability_signals: 0.1,
	soft_skills: 0.1,
	market_demand: 0.05,
	growth_trajectory: 0.05,
};

const FACTOR_META = {
	verified_skills: {
		label: 'Verified Skills',
		description: 'Assessments passed, certifications, and work samples.',
	},
	interview_performance: {
		label: 'Interview Performance',
		description: 'Mock and real interviews plus communication quality.',
	},
	experience_quality: {
		label: 'Experience Quality',
		description: 'Tenure, company tier, and role progression.',
	},
	education_credentials: {
		label: 'Education & Credentials',
		description: 'Degrees, courses, and verified credentials.',
	},
	reliability_signals: {
		label: 'Reliability Signals',
		description: 'Response time, attendance, and follow-through.',
	},
	soft_skills: {
		label: 'Soft Skills',
		description: 'Collaboration, leadership, and adaptability.',
	},
	market_demand: {
		label: 'Market Demand',
		description: 'How your skills match current job market needs.',
	},
	growth_trajectory: {
		label: 'Growth Trajectory',
		description: 'Learning velocity and skill acquisition rate.',
	},
};

// ─── Helpers ────────────────────────────────────────────────
function clamp(num, min, max) {
	return Math.max(min, Math.min(max, num));
}

function tierFromScore(total) {
	for (const [key, range] of Object.entries(SCORE_RANGES.TIERS)) {
		if (total >= range.min && total <= range.max) return key;
	}
	return 'needs_work';
}

function dbTierFromLabel(tier) {
	const map = {
		exceptional: 'platinum',
		excellent: 'gold',
		good: 'silver',
		fair: 'bronze',
		needs_work: 'new',
	};
	return map[tier] || 'new';
}

function daysBetween(a, b) {
	return Math.floor((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

// ─── Data Fetching ──────────────────────────────────────────
async function fetchCandidateData(userId) {
	const client = await pool.connect();
	try {
		// Candidate profile
		const profileRes = await client.query(`SELECT * FROM candidate_profiles WHERE user_id = $1`, [
			userId,
		]);

		// Skills
		const skillsRes = await client.query(
			`SELECT skill_name, category, level, is_verified, years_experience, created_at
			 FROM candidate_skills WHERE user_id = $1`,
			[userId],
		);

		// Work experience
		const expRes = await client.query(
			`SELECT company_name, title, start_date, end_date, is_current, description, achievements, skills_used
			 FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC`,
			[userId],
		);

		// Education
		const eduRes = await client.query(
			`SELECT institution, degree, field_of_study, start_date, end_date, gpa, achievements
			 FROM education WHERE user_id = $1 ORDER BY end_date DESC NULLS FIRST`,
			[userId],
		);

		// Skill assessments
		const assessmentsRes = await client.query(
			`SELECT score, max_score, passed, completed_at, created_at, anti_cheat_score
			 FROM skill_assessments WHERE user_id = $1 AND completed_at IS NOT NULL`,
			[userId],
		);

		// Job assessments (recruiter-assigned, proctored) — feed verified_skills at 2x weight
		const jobAssessmentsRes = await client.query(
			`SELECT jaa.composite_score, jaa.completed_at, jaa.scored_at,
			        COALESCE(ja.passing_score, 70) AS passing_score
			 FROM job_assessment_attempts jaa
			 JOIN job_assessments ja ON ja.id = jaa.assessment_id
			 WHERE jaa.candidate_id = $1
			   AND jaa.status = 'completed'
			   AND jaa.scored_at IS NOT NULL
			   AND jaa.composite_score IS NOT NULL`,
			[userId],
		);

		// Practice sessions
		const practiceRes = await client.query(
			`SELECT category, score, created_at, coaching_data
			 FROM practice_sessions WHERE user_id = $1`,
			[userId],
		);

		// Scheduled interviews
		const interviewsRes = await client.query(
			`SELECT status, outcome, feedback, scheduled_at, created_at
			 FROM scheduled_interviews WHERE candidate_id = $1`,
			[userId],
		);

		// Real interview evaluations (#793) — the three AI evaluator lenses
		// written by runMultiEvaluation. Fabricated neutral-50 fallback rows
		// (AI failure) are excluded: counting them would import a fake number.
		const evaluationsRes = await client.query(
			`SELECT score, max_score, evaluator_type, created_at
			 FROM interview_evaluations
			 WHERE candidate_id = $1
			   AND score IS NOT NULL
			   AND COALESCE(max_score, 100) > 0
			   AND (reasoning IS NULL OR reasoning <> 'AI evaluation unavailable — using neutral score')`,
			[userId],
		);

		// Job applications
		const appsRes = await client.query(
			`SELECT status, applied_at, updated_at
			 FROM job_applications WHERE candidate_id = $1`,
			[userId],
		);

		// Portfolio projects
		const projectsRes = await client.query(
			`SELECT title, technologies, created_at
			 FROM portfolio_projects WHERE user_id = $1`,
			[userId],
		);

		// Document verifications
		const docsRes = await client.query(
			`SELECT v.verification_type, d.document_type, d.status, d.verified_at
			 FROM document_verifications v
			 JOIN verification_documents d ON v.document_id = d.id
			 WHERE v.user_id = $1 AND d.status = 'verified'`,
			[userId],
		);

		// Match results (for market demand)
		const matchesRes = await client.query(
			`SELECT matching_skills, missing_skills, match_level, calculated_at
			 FROM match_results WHERE candidate_id = $1 ORDER BY calculated_at DESC LIMIT 20`,
			[userId],
		);

		// Activity log (for reliability & growth)
		const activityRes = await client.query(
			`SELECT event_type AS action_type, created_at
			 FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC`,
			[userId],
		);

		return {
			profile: profileRes.rows[0] || null,
			skills: skillsRes.rows,
			experience: expRes.rows,
			education: eduRes.rows,
			assessments: assessmentsRes.rows,
			jobAssessments: jobAssessmentsRes.rows,
			practice: practiceRes.rows,
			interviews: interviewsRes.rows,
			evaluations: evaluationsRes.rows,
			applications: appsRes.rows,
			projects: projectsRes.rows,
			docs: docsRes.rows,
			matches: matchesRes.rows,
			activity: activityRes.rows,
		};
	} finally {
		client.release();
	}
}

// ─── Factor Calculators (deterministic, 0-100 scale) ────────

function calcVerifiedSkills(data) {
	let score = 0;
	const details = [];

	// Verified skills (max 40)
	const verifiedSkills = data.skills.filter((s) => s.is_verified);
	const verifiedPts = Math.min(40, verifiedSkills.length * 8);
	score += verifiedPts;
	details.push(`${verifiedSkills.length} verified skills (+${verifiedPts})`);

	// Passed assessments (max 30) — skill self-tests at 10 pts each, job
	// assessments at 20 pts each (2x: proctored and employer-validated).
	const passedSkillAssessments = data.assessments.filter((a) => a.passed);
	const passedJobAssessments = (data.jobAssessments || []).filter(
		(a) => a.composite_score != null && a.composite_score >= (a.passing_score ?? 70),
	);
	const assessPts = Math.min(
		30,
		passedSkillAssessments.length * 10 + passedJobAssessments.length * 20,
	);
	score += assessPts;
	details.push(
		`${passedSkillAssessments.length} passed skill assessments, ${passedJobAssessments.length} passed job assessments (+${assessPts})`,
	);

	// Portfolio projects (max 20)
	const projectPts = Math.min(20, data.projects.length * 5);
	score += projectPts;
	details.push(`${data.projects.length} portfolio projects (+${projectPts})`);

	// Verified documents / certifications (max 10)
	const docPts = Math.min(10, data.docs.length * 5);
	score += docPts;
	details.push(`${data.docs.length} verified documents (+${docPts})`);

	// hasData=false when the factor consumed no input records (UI renders "Insufficient data").
	const hasData =
		verifiedSkills.length > 0 ||
		data.assessments.length > 0 ||
		(data.jobAssessments || []).length > 0 ||
		data.projects.length > 0 ||
		data.docs.length > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

function calcInterviewPerformance(data) {
	let score = 0;
	const details = [];

	// Practice session average (max 50)
	const practiceScores = data.practice
		.filter((p) => typeof p.score === 'number')
		.map((p) => p.score);
	if (practiceScores.length > 0) {
		const avg = practiceScores.reduce((a, b) => a + b, 0) / practiceScores.length;
		const practicePts = Math.min(50, avg * 5); // 0-10 scale → 0-50
		score += practicePts;
		details.push(
			`${practiceScores.length} practice sessions, avg ${avg.toFixed(1)}/10 (+${practicePts.toFixed(1)})`,
		);
	} else {
		details.push('No practice sessions yet');
	}

	// Completed real interviews with positive feedback (max 50)
	const completedInterviews = data.interviews.filter(
		(i) => i.outcome === 'completed' || i.outcome === 'passed',
	);
	const feedbackScores = completedInterviews
		.map((i) => {
			try {
				const fb = typeof i.feedback === 'string' ? JSON.parse(i.feedback) : i.feedback;
				return fb?.overall_score || fb?.rating || 0;
			} catch {
				return 0;
			}
		})
		.filter((s) => s > 0);

	// Real interview evaluations (#793) take precedence over legacy feedback:
	// one interview must never be double-counted from two sources.
	// ponytail: row-level average; per-session grouping is the upgrade path
	// if lens dropout becomes common.
	const evalScores = (data.evaluations || [])
		.map((e) => {
			const s = Number(e.score);
			const m = Number(e.max_score ?? 100) || 100;
			if (!Number.isFinite(s) || m <= 0) return null;
			return clamp((s / m) * 100, 0, 100);
		})
		.filter((s) => s !== null);

	if (evalScores.length > 0) {
		const avgEval = evalScores.reduce((a, b) => a + b, 0) / evalScores.length;
		const evalPts = Math.min(50, avgEval * 0.5); // 0-100 scale → 0-50
		score += evalPts;
		details.push(
			`${evalScores.length} interview evaluations, avg ${avgEval.toFixed(1)}/100 (+${evalPts.toFixed(1)})`,
		);
	} else if (feedbackScores.length > 0) {
		const avgFb = feedbackScores.reduce((a, b) => a + b, 0) / feedbackScores.length;
		const fbPts = Math.min(50, avgFb * 10); // 0-5 scale → 0-50
		score += fbPts;
		details.push(
			`${feedbackScores.length} interview feedbacks, avg ${avgFb.toFixed(1)}/5 (+${fbPts.toFixed(1)})`,
		);
	} else if (completedInterviews.length > 0) {
		const intPts = Math.min(50, completedInterviews.length * 10);
		score += intPts;
		details.push(`${completedInterviews.length} completed interviews (+${intPts})`);
	} else {
		details.push('No completed interviews yet');
	}

	const hasData =
		practiceScores.length > 0 || evalScores.length > 0 || completedInterviews.length > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

function calcExperienceQuality(data) {
	let score = 0;
	const details = [];

	// Total years of experience (max 40)
	let totalYears = 0;
	for (const exp of data.experience) {
		const start = exp.start_date ? new Date(exp.start_date) : null;
		const end = exp.is_current || !exp.end_date ? new Date() : new Date(exp.end_date);
		if (start && end) {
			totalYears += Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 365.25));
		}
	}
	const yearPts = Math.min(40, totalYears * 5);
	score += yearPts;
	details.push(`${totalYears.toFixed(1)} years experience (+${yearPts.toFixed(1)})`);

	// Current role bonus (max 15)
	const currentRoles = data.experience.filter((e) => e.is_current).length;
	const currentPts = Math.min(15, currentRoles * 10);
	score += currentPts;
	details.push(`${currentRoles} current role(s) (+${currentPts})`);

	// Role progression bonus (max 25)
	let progressionBonus = 0;
	if (data.experience.length >= 2) {
		const seniorityTerms = [
			'senior',
			'lead',
			'staff',
			'principal',
			'manager',
			'director',
			'head',
			'vp',
			'cto',
			'architect',
		];
		const juniorTerms = ['junior', 'intern', 'associate', 'entry'];
		const titles = data.experience.map((e) => (e.title || '').toLowerCase());
		const hasSenior = titles.some((t) => seniorityTerms.some((s) => t.includes(s)));
		const hasJunior = titles.some((t) => juniorTerms.some((j) => t.includes(j)));
		if (hasSenior && hasJunior) progressionBonus = 25;
		else if (hasSenior) progressionBonus = 15;
		else if (data.experience.length >= 3) progressionBonus = 10;
	}
	score += progressionBonus;
	details.push(`Role progression bonus (+${progressionBonus})`);

	// Achievements (max 20)
	let achievementCount = 0;
	for (const exp of data.experience) {
		if (Array.isArray(exp.achievements)) achievementCount += exp.achievements.length;
	}
	const achPts = Math.min(20, achievementCount * 4);
	score += achPts;
	details.push(`${achievementCount} documented achievements (+${achPts})`);

	const hasData = data.experience.length > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

function calcEducationCredentials(data) {
	let score = 0;
	const details = [];

	const degreeScores = {
		phd: 40,
		doctorate: 40,
		master: 30,
		mba: 30,
		bachelor: 20,
		bs: 20,
		ba: 20,
		associate: 10,
	};

	let degreePts = 0;
	for (const edu of data.education) {
		const deg = (edu.degree || '').toLowerCase();
		let pts = 5; // base for any entry
		for (const [key, val] of Object.entries(degreeScores)) {
			if (deg.includes(key)) {
				pts = val;
				break;
			}
		}
		degreePts += pts;
	}
	degreePts = Math.min(60, degreePts);
	score += degreePts;
	details.push(`Education quality (+${degreePts})`);

	// GPA bonus (max 10)
	const gpas = data.education
		.map((e) => parseFloat(e.gpa))
		.filter((g) => !Number.isNaN(g) && g > 0);
	if (gpas.length > 0) {
		const avgGpa = gpas.reduce((a, b) => a + b, 0) / gpas.length;
		const gpaPts = Math.min(10, avgGpa * 2.5);
		score += gpaPts;
		details.push(`Avg GPA ${avgGpa.toFixed(2)} (+${gpaPts.toFixed(1)})`);
	}

	// Verified credentials bonus (max 20)
	const eduDocs = data.docs.filter(
		(d) =>
			(d.verification_type || '').toLowerCase().includes('education') ||
			(d.document_type || '').toLowerCase().includes('education'),
	);
	const docPts = Math.min(20, eduDocs.length * 10);
	score += docPts;
	details.push(`${eduDocs.length} verified education docs (+${docPts})`);

	// Field diversity (max 10)
	const fields = new Set(
		data.education.map((e) => (e.field_of_study || '').toLowerCase().trim()).filter(Boolean),
	);
	const fieldPts = Math.min(10, fields.size * 5);
	score += fieldPts;
	details.push(`${fields.size} fields of study (+${fieldPts})`);

	const hasData = data.education.length > 0 || eduDocs.length > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

function calcReliabilitySignals(data) {
	const details = [];

	// #1776 (panel ruling on #1761, Option D): measured-only raw. There is
	// no neutral base and no default rate — a sub-signal contributes only
	// when it was actually measured, and raw renormalises over the
	// measured weights (the #1731 measured-only pattern): attendance
	// (weight 60) only when >=1 interview is scheduled, follow-through
	// (weight 40) only when >=1 application exists. Both measured:
	// raw = 60a + 40f - penalty. One measured: that rate alone, scaled
	// to 0-100. None measured: raw 0 with hasData=false (#1538 persists
	// null), and no attendance/follow-through detail string is produced.
	// Vocabulary grounded in the real scheduled_interviews schema/writers
	// (Quinn gate failure on PR #1778, 2026-10-23): status and outcome are
	// different vocabularies. chk_scheduled_interviews_status allows
	// scheduled/confirmed/completed/cancelled/no_show (+rescheduled in
	// migrations/p2_schema_hardening.sql:2809, in_progress in
	// migrations/047_p2_schema_hardening.js — both agree on the values
	// used here; read back identically from a fresh migrate.js DB), while
	// chk_scheduled_interviews_outcome (p2_schema_hardening.sql:2820)
	// allows only passed/failed/pending_review/no_decision/NULL. Writers
	// agree: routes/recruiter.js PUT /interviews/:id passes status and
	// outcome through separately (Quinn's attended write was status
	// 'completed' + outcome 'passed'; her no-show write was status
	// 'no_show' + outcome NULL), routes/interviews.js and
	// routes/candidate.js write cancellations as status 'cancelled'
	// (candidate decline even puts a free-text reason in outcome). So:
	// attended := status 'completed' OR outcome 'passed' (outcome
	// 'completed' cannot exist per the CHECK — the pre-fix rule relied on
	// it); no-shows := status IN ('no_show','cancelled') ONLY — the
	// outcome variants are dropped because no writer writes them and the
	// CHECK forbids them (PG 23514), which is why the penalty never fired
	// on real data (Quinn's candidate scored 70 instead of 60).
	const scheduled = data.interviews.length;
	const completed = data.interviews.filter(
		(i) => i.status === 'completed' || i.outcome === 'passed',
	).length;
	const noShows = data.interviews.filter(
		(i) => i.status === 'no_show' || i.status === 'cancelled',
	).length;
	const attendanceMeasured = scheduled > 0;
	const attendanceRate = attendanceMeasured ? completed / scheduled : null;

	const totalApps = data.applications.length;
	const withdrawnApps = data.applications.filter((a) => a.status === 'withdrawn').length;
	const followMeasured = totalApps > 0;
	const followRate = followMeasured ? (totalApps - withdrawnApps) / totalApps : null;

	let weighted = 0;
	let weightSum = 0;
	if (attendanceMeasured) {
		weighted += attendanceRate * 60;
		weightSum += 60;
	}
	if (followMeasured) {
		weighted += followRate * 40;
		weightSum += 40;
	}
	// Detail points are each sub-signal's renormalised contribution.
	if (attendanceMeasured) {
		const pts = (attendanceRate * 60 * 100) / weightSum;
		details.push(
			`Interview attendance ${(attendanceRate * 100).toFixed(0)}% (+${pts.toFixed(1)})`,
		);
	}
	if (followMeasured) {
		const pts = (followRate * 40 * 100) / weightSum;
		details.push(
			`Application follow-through ${(followRate * 100).toFixed(0)}% (+${pts.toFixed(1)})`,
		);
	}

	// Penalty for no-shows — only when interviews are measured.
	const noShowPenalty = attendanceMeasured ? Math.min(20, noShows * 10) : 0;
	if (noShowPenalty > 0) details.push(`${noShows} no-shows/cancellations (-${noShowPenalty})`);

	const hasData = weightSum > 0;
	const coverage = { attendance: attendanceMeasured, followThrough: followMeasured };
	// Partial coverage must be stated wherever this factor is graded or
	// labelled (AC-2 main text) — a single-component score is never an
	// unqualified grade.
	let coverageNote = null;
	if (hasData && !attendanceMeasured)
		coverageNote = 'based on application follow-through only; attendance: insufficient data';
	else if (hasData && !followMeasured)
		coverageNote =
			'based on interview attendance only; application follow-through: insufficient data';

	return {
		raw: hasData ? clamp((weighted / weightSum) * 100 - noShowPenalty, 0, 100) : 0,
		details,
		hasData,
		coverage,
		coverageNote,
	};
}

function calcSoftSkills(data) {
	let score = 0;
	const details = [];

	// Practice sessions in soft-skill categories
	const softCategories = [
		'communication',
		'leadership',
		'teamwork',
		'behavioral',
		'collaboration',
		'adaptability',
	];
	const softSessions = data.practice.filter((p) =>
		softCategories.some((c) => (p.category || '').toLowerCase().includes(c)),
	);
	if (softSessions.length > 0) {
		const avg = softSessions.reduce((s, p) => s + (p.score || 0), 0) / softSessions.length;
		const pts = Math.min(60, avg * 6);
		score += pts;
		details.push(
			`${softSessions.length} soft-skill practices, avg ${avg.toFixed(1)}/10 (+${pts.toFixed(1)})`,
		);
	} else {
		details.push('No soft-skill practice sessions yet');
	}

	// Interview feedback soft-skill signals
	let feedbackScore = 0;
	let feedbackCount = 0;
	for (const iv of data.interviews) {
		try {
			const fb = typeof iv.feedback === 'string' ? JSON.parse(iv.feedback) : iv.feedback;
			if (fb) {
				const comm = fb.communication || fb.soft_skills || fb.collaboration || 0;
				if (comm > 0) {
					feedbackScore += comm;
					feedbackCount++;
				}
			}
		} catch {
			// ignore
		}
	}
	if (feedbackCount > 0) {
		const avgFb = feedbackScore / feedbackCount;
		const pts = Math.min(40, avgFb * 8);
		score += pts;
		details.push(
			`${feedbackCount} soft-skill feedbacks, avg ${avgFb.toFixed(1)}/5 (+${pts.toFixed(1)})`,
		);
	} else {
		details.push('No soft-skill interview feedback yet');
	}

	const hasData = softSessions.length > 0 || feedbackCount > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

function calcMarketDemand(data) {
	let score = 0;
	const details = [];

	// Use match_results to see how in-demand skills are
	if (data.matches.length > 0) {
		const goodMatches = data.matches.filter((m) => ['good', 'excellent'].includes(m.match_level));
		const matchRate = goodMatches.length / data.matches.length;
		const pts = Math.min(100, matchRate * 100);
		score += pts;
		details.push(
			`${goodMatches.length}/${data.matches.length} strong job matches (+${pts.toFixed(1)})`,
		);
	} else {
		// Fallback: estimate from skills categories
		const inDemandCategories = [
			'software engineering',
			'data science',
			'cloud',
			'ai',
			'security',
			'devops',
		];
		const skillCategories = new Set(data.skills.map((s) => (s.category || '').toLowerCase()));
		const matchCount = [...skillCategories].filter((c) =>
			inDemandCategories.some((d) => c.includes(d)),
		).length;
		const pts = Math.min(100, matchCount * 20 + 20);
		score += pts;
		details.push(`${matchCount} in-demand skill categories (+${pts})`);
	}

	const hasData = data.matches.length > 0 || data.skills.length > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

function calcGrowthTrajectory(data) {
	let score = 0;
	const details = [];

	const now = new Date();

	// Skill acquisition rate: new skills in last 90 days
	const recentSkills = data.skills.filter((s) => {
		if (!s.created_at) return false;
		return daysBetween(s.created_at, now) <= 90;
	});
	const skillRatePts = Math.min(40, recentSkills.length * 10);
	score += skillRatePts;
	details.push(`${recentSkills.length} new skills in last 90d (+${skillRatePts})`);

	// Assessment velocity in last 90 days
	const recentAssessments = data.assessments.filter((a) => {
		if (!a.completed_at) return false;
		return daysBetween(a.completed_at, now) <= 90;
	});
	const assessPts = Math.min(30, recentAssessments.length * 10);
	score += assessPts;
	details.push(`${recentAssessments.length} assessments in last 90d (+${assessPts})`);

	// Activity streak: weeks with any activity in last 30 days
	const recentActivity = data.activity.filter((a) => daysBetween(a.created_at, now) <= 30);
	const activeWeeks = new Set(
		recentActivity.map((a) => {
			const d = new Date(a.created_at);
			return `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7)}`;
		}),
	).size;
	const streakPts = Math.min(30, activeWeeks * 10);
	score += streakPts;
	details.push(`${activeWeeks} active weeks in last 30d (+${streakPts})`);

	const hasData = data.skills.length > 0 || data.assessments.length > 0 || data.activity.length > 0;

	return {
		raw: clamp(score, 0, 100),
		details,
		hasData,
	};
}

// ─── Fraud Detection Heuristics ─────────────────────────────
function detectFraudSignals(_userId, data, factors) {
	const signals = [];

	// 1. Resume inflation: self-reported skills vs verified ratio
	const totalSkills = data.skills.length;
	const verifiedSkills = data.skills.filter((s) => s.is_verified).length;
	if (totalSkills > 5 && verifiedSkills / totalSkills < 0.2) {
		signals.push({
			type: 'skill_inflation',
			severity: 'medium',
			message: `Only ${verifiedSkills}/${totalSkills} skills are verified`,
		});
	}

	// 2. Experience gap detection
	if (data.experience.length >= 2) {
		const sorted = [...data.experience].sort((a, b) => {
			const da = a.start_date ? new Date(a.start_date) : new Date(0);
			const db = b.start_date ? new Date(b.start_date) : new Date(0);
			return db - da;
		});
		for (let i = 0; i < sorted.length - 1; i++) {
			const current = sorted[i];
			const next = sorted[i + 1];
			const endCurrent =
				current.is_current || !current.end_date ? new Date() : new Date(current.end_date);
			const startNext = next.start_date ? new Date(next.start_date) : null;
			if (startNext && endCurrent) {
				const gapDays = (startNext - endCurrent) / (1000 * 60 * 60 * 24);
				if (gapDays > 365) {
					signals.push({
						type: 'experience_gap',
						severity: 'low',
						message: `Gap of ${Math.round(gapDays / 30)} months between roles`,
					});
					break; // only report first gap
				}
			}
		}
	}

	// 3. Score-component inconsistency
	if (factors.verified_skills.raw > 70 && factors.interview_performance.raw < 20) {
		signals.push({
			type: 'performance_mismatch',
			severity: 'low',
			message: 'High skill claims but low interview performance',
		});
	}

	// 4. Anti-cheat red flags from assessments — #1715 O3: missing
	// anti_cheat_score stays missing (?? null): absence raises no flag,
	// and a genuine measured 0 is data, not absence — it must flag
	// instead of being rewritten to a perfect 100 by `||`.
	const suspiciousAssessments = data.assessments.filter((a) => {
		const antiCheat = a.anti_cheat_score ?? null;
		return antiCheat !== null && antiCheat < 50;
	});
	if (suspiciousAssessments.length > 0) {
		signals.push({
			type: 'suspicious_assessment',
			severity: 'high',
			message: `${suspiciousAssessments.length} assessment(s) flagged for suspicious behavior`,
		});
	}

	return signals;
}

// ─── Core Score Computation ─────────────────────────────────
async function computeFactors(userId) {
	const data = await fetchCandidateData(userId);

	const factors = {
		verified_skills: calcVerifiedSkills(data),
		interview_performance: calcInterviewPerformance(data),
		experience_quality: calcExperienceQuality(data),
		education_credentials: calcEducationCredentials(data),
		reliability_signals: calcReliabilitySignals(data),
		soft_skills: calcSoftSkills(data),
		market_demand: calcMarketDemand(data),
		growth_trajectory: calcGrowthTrajectory(data),
	};

	// ponytail: factors with no evidence keep their computed raw score and are
	// flagged via hasData for the UI ("Insufficient data"). Weights are NOT
	// re-normalized across data-bearing factors: that changes scoring semantics
	// and needs validation against real hiring outcomes first. Upgrade path:
	// confidence-weighted totals once outcome data exists (#113).
	// Compute weighted total
	let weightedSum = 0;
	for (const [key, factor] of Object.entries(factors)) {
		weightedSum += (factor.raw / 100) * FACTOR_WEIGHTS[key];
	}

	const total = Math.round(SCORE_RANGES.MIN + weightedSum * 550);
	const clampedTotal = clamp(total, SCORE_RANGES.MIN, SCORE_RANGES.MAX);

	// Fraud detection
	const fraudSignals = detectFraudSignals(userId, data, factors);

	return {
		total: clampedTotal,
		factors,
		fraudSignals,
		tier: tierFromScore(clampedTotal),
		// #1192: a candidate whose every factor reports has_data:false has no
		// score — the floor formula's output is an artifact, not a verdict.
		hasAnyData: Object.values(factors).some((f) => f.hasData),
	};
}

// ─── Public API ─────────────────────────────────────────────

/**
 * #1192: the engine's own no-data predicate — true when at least one factor
 * reports has_data. Used by the legacy-row heal script so the engine, not a
 * value heuristic, arbitrates which stored rows are real.
 */
async function hasScoreData(userId) {
	const { hasAnyData } = await computeFactors(userId);
	return hasAnyData;
}

async function getOrCreateScore(userId) {
	const existing = await pool.query('SELECT * FROM omni_scores WHERE user_id = $1', [userId]);
	if (existing.rows.length > 0) {
		return existing.rows[0];
	}

	// #1192: seed an honest null, never the 300 starter literal — a row
	// created here is served by the profile's LEFT JOIN before any compute.
	const result = await pool.query(
		`INSERT INTO omni_scores (user_id, total_score, score_tier, version)
     VALUES ($1, NULL, NULL, 2)
     RETURNING *`,
		[userId],
	);
	return result.rows[0];
}

// #1538: the persisted factor_scores shape, shared by both write sites in
// calculateScore() (omni_scores UPDATE + score_snapshots INSERT) so the two
// can never drift. A factor with no underlying data persists as JSON null —
// the honest "insufficient data" — never a flattened number (its raw is a
// default or 0, not a measurement). A measured factor persists as its
// rounded raw, so a genuine measured 0 stays distinguishable from null.
function persistedFactorScores(factors) {
	return Object.fromEntries(
		Object.entries(factors).map(([k, v]) => [k, v.hasData ? Math.round(v.raw) : null]),
	);
}

/**
 * Calculate score on-demand (deterministic). Does NOT require explicit checkin.
 */
async function calculateScore(userId) {
	const { total, factors, fraudSignals, tier, hasAnyData } = await computeFactors(userId);
	const noData = !hasAnyData;

	// Backwards-compat mapping to old columns. #1596: the compat columns
	// follow the #1538 rule — a column averages its MEASURED source
	// factors only, and is null when no source factor has data. A no-data
	// factor's raw is a neutral default or 0, not a measurement: averaging
	// it in fabricated a behavior_score of 43 for the #1588 candidate
	// (reliability 85 via 1 application under the pre-#1776 neutral-base
	// semantics, soft_skills unmeasured) and halved a measured resume
	// raw of 10 into 5.
	const compatScore = (...sources) => {
		const measured = sources.filter((f) => f.hasData);
		return measured.length === 0
			? null
			: Math.round(measured.reduce((sum, f) => sum + f.raw, 0) / measured.length);
	};
	const interview_score = compatScore(factors.interview_performance);
	const technical_score = compatScore(factors.verified_skills);
	const resume_score = compatScore(factors.experience_quality, factors.education_credentials);
	const behavior_score = compatScore(factors.reliability_signals, factors.soft_skills);

	// Compute peer percentile (a no-data candidate has no percentile — the
	// 50th-percentile default is the same fabrication as the floor total).
	// #1251 honest-null: the denominator counts only SCORED peers
	// (COUNT(total_score) skips NULL totals), so when no scored peers exist
	// the expression is NULL — and a NULL percentile stays null, never a
	// fabricated 50. (Numerator needs no change: NULL <= $1 is never true.)
	let peerPercentile = null;
	if (!noData) {
		const percentileRes = await pool.query(
			`SELECT COUNT(*) FILTER (WHERE total_score <= $1) * 100.0 / NULLIF(COUNT(total_score), 0) as percentile
     FROM omni_scores`,
			[total],
		);
		const rawPercentile = percentileRes.rows[0]?.percentile;
		const parsedPercentile =
			rawPercentile === null || rawPercentile === undefined ? NaN : parseFloat(rawPercentile);
		// NaN (NULL / non-numeric) stays honest null — never a number, never 50.
		peerPercentile = Number.isNaN(parsedPercentile) ? null : Math.round(parsedPercentile);
	}

	// Update the score record
	await pool.query(
		`UPDATE omni_scores SET
      total_score = $1,
      interview_score = $2,
      technical_score = $3,
      resume_score = $4,
      behavior_score = $5,
      score_tier = $6,
      factor_scores = $7,
      peer_percentile = $8,
      fraud_signals = $9,
      last_updated = NOW(),
      version = 2
    WHERE user_id = $10`,
		[
			// #1192 persisted-row trap: a no-data compute must overwrite any
			// stored starter/floor total with NULL, so the profile LEFT JOIN
			// can never serve a fabricated verdict after this call.
			noData ? null : total,
			interview_score,
			technical_score,
			resume_score,
			behavior_score,
			noData ? null : dbTierFromLabel(tier),
			JSON.stringify(persistedFactorScores(factors)),
			peerPercentile,
			JSON.stringify(fraudSignals),
			userId,
		],
	);

	// Weekly snapshot (idempotent — only one per week). Skipped when noData:
	// a snapshot of a fabricated total would re-create the verdict on read.
	if (!noData)
		await pool.query(
			`INSERT INTO score_snapshots (user_id, total_score, factor_scores, peer_percentile, snapshot_week, created_at)
     VALUES ($1, $2, $3, $4, DATE_TRUNC('week', CURRENT_DATE)::DATE, NOW())
     ON CONFLICT (user_id, snapshot_week) DO UPDATE SET
       total_score = EXCLUDED.total_score,
       factor_scores = EXCLUDED.factor_scores,
       peer_percentile = EXCLUDED.peer_percentile,
       created_at = NOW()`,
			[
				userId,
				total,
				JSON.stringify(persistedFactorScores(factors)),
				peerPercentile,
			],
		);

	return {
		total_score: noData ? null : total,
		interview: interview_score,
		technical: technical_score,
		resume: resume_score,
		behavior: behavior_score,
		tier: noData ? null : tier,
		tier_label: noData ? null : SCORE_RANGES.TIERS[tier]?.label || 'New',
		peer_percentile: peerPercentile,
		fraud_signals: fraudSignals,
		scoring_semantics_version: SCORING_SEMANTICS_VERSION,
		factors: Object.fromEntries(
			Object.entries(factors).map(([k, v]) => [
				k,
				{
					raw: Math.round(v.raw),
					weight: FACTOR_WEIGHTS[k],
					details: v.details,
					hasData: v.hasData,
					// #1776: per-sub-signal coverage (reliability only today;
					// null elsewhere) so grading surfaces can state it.
					coverage: v.coverage ?? null,
					coverageNote: v.coverageNote ?? null,
				},
			]),
		),
	};
}

// ─── Checkin (rate-limited to once per day) ─────────────────

async function recordCheckin(userId) {
	const existing = await pool.query(`SELECT last_checkin_at FROM omni_scores WHERE user_id = $1`, [
		userId,
	]);

	const lastCheckin = existing.rows[0]?.last_checkin_at;
	if (lastCheckin) {
		const lastDate = new Date(lastCheckin).toISOString().split('T')[0];
		const today = new Date().toISOString().split('T')[0];
		if (lastDate === today) {
			return { already_checked_in: true, points_earned: 0 };
		}
	}

	// Record checkin timestamp + small behavior component (only once per day)
	await pool.query(`UPDATE omni_scores SET last_checkin_at = NOW() WHERE user_id = $1`, [userId]);

	await addBehaviorComponent(userId, 'daily_login', 5, 10);
	const newScore = await calculateScore(userId);

	return { already_checked_in: false, points_earned: 5, new_score: newScore.total_score };
}

// ─── Component Adders (called by other services) ────────────

async function addInterviewComponent(userId, interviewId, score, maxScore = 10) {
	const points = Math.round((score / maxScore) * 40);
	await pool.query(
		`INSERT INTO score_components (user_id, component_type, source_type, source_id, points, max_points)
     VALUES ($1, 'interview', 'interview', $2, $3, 40)`,
		[userId, interviewId, points],
	);
	await recordHistory(userId, 'Completed mock interview', 'interview');
	return calculateScore(userId);
}

async function addTechnicalComponent(userId, assessmentId, score, maxScore = 100) {
	const points = Math.round((score / maxScore) * 40);
	await pool.query(
		`INSERT INTO score_components (user_id, component_type, source_type, source_id, points, max_points)
     VALUES ($1, 'technical', 'assessment', $2, $3, 40)`,
		[userId, String(assessmentId), points],
	);
	await recordHistory(userId, 'Completed skill assessment', 'technical');
	return calculateScore(userId);
}

async function addResumeComponent(userId, score, maxScore = 100) {
	const points = Math.round((score / maxScore) * 200);
	await pool.query(
		`INSERT INTO score_components (user_id, component_type, source_type, source_id, points, max_points)
     VALUES ($1, 'resume', 'resume_score', 'latest', $2, 200)
     ON CONFLICT (user_id, component_type, source_type, source_id)
     DO UPDATE SET points = $2, created_at = NOW()`,
		[userId, points],
	);
	await recordHistory(userId, 'Resume quality updated', 'resume');
	return calculateScore(userId);
}

async function addBehaviorComponent(userId, reason, points, maxPoints = 10) {
	await pool.query(
		`INSERT INTO score_components (user_id, component_type, source_type, points, max_points, metadata)
     VALUES ($1, 'behavior', 'activity', $2, $3, $4)`,
		[userId, points, maxPoints, JSON.stringify({ reason })],
	);
	return calculateScore(userId);
}

async function onProfileUpdate(userId, changeType) {
	const oldScore = await getOrCreateScore(userId);
	const newScoreData = await calculateScore(userId);
	if (newScoreData.total_score !== oldScore.total_score) {
		await recordHistory(userId, `Profile updated: ${changeType}`, 'behavior');
	}
	return newScoreData;
}

async function recordHistory(userId, reason, componentType) {
	const old = await getOrCreateScore(userId);
	const updated = await calculateScore(userId);
	await pool.query(
		`INSERT INTO score_history
     (user_id, previous_score, new_score, change_amount, change_reason, component_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
		[
			userId,
			old.total_score,
			updated.total_score,
			updated.total_score - old.total_score,
			reason,
			componentType,
		],
	);
}

// ─── Score Breakdown (for /breakdown endpoint) ──────────────

async function getScoreBreakdown(userId) {
	const scoreData = await calculateScore(userId);

	const recentComponents = await pool.query(
		`SELECT component_type, source_type, points, max_points, created_at
     FROM score_components WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
		[userId],
	);

	const history = await pool.query(
		`SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
     FROM score_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
		[userId],
	);

	// Build 8-factor breakdown with weights
	const factorBreakdown = {};
	for (const [key, meta] of Object.entries(FACTOR_META)) {
		const factorData = scoreData.factors[key];
		factorBreakdown[key] = {
			score: factorData?.raw || 0,
			max: 100,
			has_data: factorData?.hasData ?? true,
			weight: FACTOR_WEIGHTS[key],
			weighted_contribution: Math.round(((factorData?.raw || 0) / 100) * FACTOR_WEIGHTS[key] * 550),
			label: meta.label,
			description: meta.description,
			details: factorData?.details || [],
			// #1776: partial-coverage note (reliability) rides the breakdown
			// so the grading surface states it; null when fully measured.
			coverage_note: factorData?.coverageNote ?? null,
		};
	}

	return {
		current: {
			total_score: scoreData.total_score,
			interview: scoreData.interview,
			technical: scoreData.technical,
			resume: scoreData.resume,
			behavior: scoreData.behavior,
			tier: scoreData.tier,
			tier_label: scoreData.tier_label,
			peer_percentile: scoreData.peer_percentile,
			fraud_signals: scoreData.fraud_signals,
		},
		breakdown: factorBreakdown,
		recent_activity: recentComponents.rows,
		history: history.rows,
		recommendations: generateRecommendations(scoreData),
	};
}

// ─── Explainer (for /explainer endpoint) ────────────────────

async function getScoreExplainer(userId) {
	const scoreData = await calculateScore(userId);
	const factors = scoreData.factors;

	const explainers = [];
	for (const [key, meta] of Object.entries(FACTOR_META)) {
		const f = factors[key];
		const raw = f?.raw || 0;

		// #1776 explainer gate (panel companion on #1761): a factor with no
		// measured data gets no grade and no verdict — "Insufficient data".
		// Before this gate the explainer graded reliability's neutral-
		// default 85 "Excellent / exceptional" for zero-input candidates.
		if (!f?.hasData) {
			explainers.push({
				name: meta.label,
				impact: 0,
				raw_score: raw,
				weight: FACTOR_WEIGHTS[key],
				grade: 'Insufficient data',
				description: meta.description,
				plain_text: 'Insufficient data',
				details: f?.details || [],
				action: null,
				has_data: false,
				coverage_note: null,
			});
			continue;
		}

		let grade = 'Needs Work';
		if (raw >= 80) grade = 'Excellent';
		else if (raw >= 60) grade = 'Good';
		else if (raw >= 40) grade = 'Fair';

		let plainText = '';
		if (raw >= 80)
			plainText = `Your ${meta.label.toLowerCase()} is exceptional — a major strength.`;
		else if (raw >= 60) plainText = `Your ${meta.label.toLowerCase()} is solid and competitive.`;
		else if (raw >= 40)
			plainText = `Your ${meta.label.toLowerCase()} is average — there's room to improve.`;
		else
			plainText = `Your ${meta.label.toLowerCase()} needs attention — this is a growth opportunity.`;

		// #1776 AC-2: partial coverage qualifies the verdict in the text
		// itself, so the grade is never presented unqualified.
		const coverageNote = f?.coverageNote ?? null;
		if (coverageNote) plainText += ` Coverage: ${coverageNote}.`;

		explainers.push({
			name: meta.label,
			impact: Math.round((raw / 100) * FACTOR_WEIGHTS[key] * 550),
			raw_score: raw,
			weight: FACTOR_WEIGHTS[key],
			grade,
			description: meta.description,
			plain_text: plainText,
			details: f?.details || [],
			action: raw < 60 ? getImprovementAction(key) : null,
			has_data: true,
			coverage_note: coverageNote,
		});
	}

	// Peer comparison. #1219: the old query also selected
	// `PERCENT_RANK() WITHIN GROUP (ORDER BY total_score)` — a hypothetical-set
	// aggregate with zero direct arguments against one ordering column, which
	// Postgres can never resolve ("function percent_rank(integer) does not
	// exist") and which 500'd this endpoint. Its result was never used:
	// percentile comes from calculateScore (COUNT FILTER / NULLIF, above).
	const percentileRes = await pool.query(
		`SELECT
      AVG(total_score) as avg_score,
      MAX(total_score) as top_score,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_score) as median_score
     FROM omni_scores`,
	);
	const peerStats = percentileRes.rows[0] || {};
	const userPercentile = scoreData.peer_percentile;
	// #1219/#1192 honest-null: aggregates over an empty omni_scores table are
	// NULL — serve null, never the old fabricated 500/1000/500 fallbacks.
	const peerStat = (v) => (v === null || v === undefined ? null : Math.round(parseFloat(v)));

	return {
		factors: explainers.sort((a, b) => b.impact - a.impact),
		peerComparison: {
			percentile: userPercentile,
			avgScore: peerStat(peerStats.avg_score),
			topScore: peerStat(peerStats.top_score),
			medianScore: peerStat(peerStats.median_score),
		},
		improvementRoadmap: buildRoadmap(factors),
		fraud_signals: scoreData.fraud_signals,
	};
}

function getImprovementAction(factorKey) {
	const actions = {
		verified_skills: 'Take a skill assessment or get a certification verified.',
		interview_performance: 'Complete 2-3 mock interviews to sharpen your answers.',
		experience_quality: 'Add detailed achievements and quantify outcomes.',
		education_credentials: 'Upload verified transcripts or add completed courses.',
		reliability_signals: 'Respond promptly to interview invites and avoid cancellations.',
		soft_skills: 'Practice behavioral questions focused on teamwork and leadership.',
		market_demand: 'Learn an in-demand skill like cloud, AI, or security.',
		growth_trajectory: 'Set a weekly learning goal and track your streak.',
	};
	return actions[factorKey] || 'Keep building your profile.';
}

function buildRoadmap(factors) {
	const roadmap = [];
	let step = 1;

	const ordered = Object.entries(factors).sort((a, b) => (a[1]?.raw || 0) - (b[1]?.raw || 0));
	for (const [key, factor] of ordered.slice(0, 4)) {
		if ((factor?.raw || 0) >= 80) continue;
		const meta = FACTOR_META[key];
		roadmap.push({
			step: step++,
			title: `Improve ${meta.label}`,
			description: meta.description,
			estimatedPoints: Math.round(((80 - (factor?.raw || 0)) / 100) * FACTOR_WEIGHTS[key] * 550),
			difficulty: (factor?.raw || 0) < 30 ? 'hard' : (factor?.raw || 0) < 60 ? 'medium' : 'easy',
			timeEstimate: '30 min - 2 hours',
		});
	}

	return roadmap;
}

// ─── Recommendations ────────────────────────────────────────

function generateRecommendations(scoreData) {
	const recs = [];
	const factors = scoreData.factors;

	if (factors.interview_performance.raw < 50) {
		recs.push({
			type: 'interview',
			priority: 'high',
			title: 'Complete More Mock Interviews',
			description: 'Your interview score has room to grow. Complete 3-5 more practice sessions.',
			potential_gain: Math.round(0.3 * FACTOR_WEIGHTS.interview_performance * 550),
		});
	}
	if (factors.verified_skills.raw < 50) {
		recs.push({
			type: 'technical',
			priority: 'high',
			title: 'Take Skill Assessments',
			description: 'Pass verified assessments to prove your technical abilities.',
			potential_gain: Math.round(0.4 * FACTOR_WEIGHTS.verified_skills * 550),
		});
	}
	if (factors.experience_quality.raw < 50) {
		recs.push({
			type: 'resume',
			priority: 'medium',
			title: 'Enhance Your Work Experience',
			description: 'Add detailed achievements and quantify your impact.',
			potential_gain: Math.round(0.3 * FACTOR_WEIGHTS.experience_quality * 550),
		});
	}
	if (factors.reliability_signals.raw < 50) {
		recs.push({
			type: 'behavior',
			priority: 'medium',
			title: 'Improve Reliability Signals',
			description: 'Respond promptly to invites and attend all scheduled interviews.',
			potential_gain: Math.round(0.2 * FACTOR_WEIGHTS.reliability_signals * 550),
		});
	}
	if (factors.growth_trajectory.raw < 50) {
		recs.push({
			type: 'growth',
			priority: 'low',
			title: 'Accelerate Your Learning',
			description: 'Set weekly learning goals and track your progress.',
			potential_gain: Math.round(0.25 * FACTOR_WEIGHTS.growth_trajectory * 550),
		});
	}

	return recs;
}

// ─── Weekly Snapshots ───────────────────────────────────────

async function getWeeklySnapshots(userId, limit = 12) {
	const result = await pool.query(
		`SELECT total_score, factor_scores, peer_percentile, snapshot_week, created_at
     FROM score_snapshots
     WHERE user_id = $1
     ORDER BY snapshot_week DESC
     LIMIT $2`,
		[userId, limit],
	);
	return result.rows;
}

// ─── Role Scores ────────────────────────────────────────────

async function getRoleScores(userId) {
	const result = await pool.query(
		`SELECT role_name, score, interview_count, last_updated
     FROM role_scores WHERE user_id = $1 ORDER BY score DESC`,
		[userId],
	);
	return result.rows;
}

async function updateRoleScore(userId, roleName, interviewScore) {
	const result = await pool.query(
		`INSERT INTO role_scores (user_id, role_name, score, interview_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id, role_name) DO UPDATE SET
       score = GREATEST(role_scores.score, EXCLUDED.score),
       interview_count = role_scores.interview_count + 1,
       last_updated = NOW()
     RETURNING *`,
		[userId, roleName, SCORE_RANGES.MIN + Math.round((interviewScore / 10) * 550)],
	);
	return result.rows[0];
}

module.exports = {
	SCORING_SEMANTICS_VERSION,
	calcVerifiedSkills,
	calcInterviewPerformance,
	calcExperienceQuality,
	calcEducationCredentials,
	calcReliabilitySignals,
	calcSoftSkills,
	calcMarketDemand,
	calcGrowthTrajectory,
	SCORE_RANGES,
	FACTOR_WEIGHTS,
	FACTOR_META,
	getOrCreateScore,
	calculateScore,
	hasScoreData,
	recordCheckin,
	addInterviewComponent,
	addTechnicalComponent,
	addResumeComponent,
	addBehaviorComponent,
	onProfileUpdate,
	getScoreBreakdown,
	getScoreExplainer,
	getWeeklySnapshots,
	generateRecommendations,
	getRoleScores,
	updateRoleScore,
};
