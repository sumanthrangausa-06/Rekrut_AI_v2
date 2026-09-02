// OmniScore Service v2 — 8-Factor Deep Scoring with Explainability
// Issue #113
// Deterministic, reproducible, and fraud-aware candidate scoring.

const pool = require('../lib/db');

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

		// Practice sessions
		const practiceRes = await client.query(
			`SELECT category, score, created_at, coaching_data
			 FROM practice_sessions WHERE user_id = $1`,
			[userId],
		);

		// Scheduled interviews
		const interviewsRes = await client.query(
			`SELECT outcome, feedback, scheduled_at, created_at
			 FROM scheduled_interviews WHERE candidate_id = $1`,
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
			practice: practiceRes.rows,
			interviews: interviewsRes.rows,
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

	// Passed assessments (max 30)
	const passedAssessments = data.assessments.filter((a) => a.passed);
	const assessPts = Math.min(30, passedAssessments.length * 10);
	score += assessPts;
	details.push(`${passedAssessments.length} passed assessments (+${assessPts})`);

	// Portfolio projects (max 20)
	const projectPts = Math.min(20, data.projects.length * 5);
	score += projectPts;
	details.push(`${data.projects.length} portfolio projects (+${projectPts})`);

	// Verified documents / certifications (max 10)
	const docPts = Math.min(10, data.docs.length * 5);
	score += docPts;
	details.push(`${data.docs.length} verified documents (+${docPts})`);

	return {
		raw: clamp(score, 0, 100),
		details,
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

	if (feedbackScores.length > 0) {
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

	return {
		raw: clamp(score, 0, 100),
		details,
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

	return {
		raw: clamp(score, 0, 100),
		details,
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
	const gpas = data.education.map((e) => parseFloat(e.gpa)).filter((g) => !isNaN(g) && g > 0);
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

	return {
		raw: clamp(score, 0, 100),
		details,
	};
}

function calcReliabilitySignals(data) {
	let score = 50; // start neutral
	const details = [];

	// Attendance rate: completed interviews / scheduled interviews
	const scheduled = data.interviews.length;
	const completed = data.interviews.filter(
		(i) => i.outcome === 'completed' || i.outcome === 'passed',
	).length;
	const noShows = data.interviews.filter(
		(i) => i.outcome === 'no_show' || i.outcome === 'cancelled',
	).length;
	const attendanceRate = scheduled > 0 ? completed / scheduled : 0.5;
	const attendancePts = attendanceRate * 30;
	score += attendancePts;
	details.push(
		`Interview attendance ${(attendanceRate * 100).toFixed(0)}% (+${attendancePts.toFixed(1)})`,
	);

	// Application follow-through (not withdrawn)
	const totalApps = data.applications.length;
	const withdrawnApps = data.applications.filter((a) => a.status === 'withdrawn').length;
	const followRate = totalApps > 0 ? (totalApps - withdrawnApps) / totalApps : 1;
	const followPts = followRate * 20;
	score += followPts;
	details.push(
		`Application follow-through ${(followRate * 100).toFixed(0)}% (+${followPts.toFixed(1)})`,
	);

	// Penalty for no-shows
	const noShowPenalty = Math.min(20, noShows * 10);
	score -= noShowPenalty;
	if (noShowPenalty > 0) details.push(`${noShows} no-shows/cancellations (-${noShowPenalty})`);

	return {
		raw: clamp(score, 0, 100),
		details,
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

	return {
		raw: clamp(score, 0, 100),
		details,
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

	return {
		raw: clamp(score, 0, 100),
		details,
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

	return {
		raw: clamp(score, 0, 100),
		details,
	};
}

// ─── Fraud Detection Heuristics ─────────────────────────────
function detectFraudSignals(userId, data, factors) {
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

	// 4. Anti-cheat red flags from assessments
	const suspiciousAssessments = data.assessments.filter((a) => {
		const antiCheat = a.anti_cheat_score || 100;
		return antiCheat < 50;
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
	};
}

// ─── Public API ─────────────────────────────────────────────

async function getOrCreateScore(userId) {
	const existing = await pool.query('SELECT * FROM omni_scores WHERE user_id = $1', [userId]);
	if (existing.rows.length > 0) {
		return existing.rows[0];
	}

	const result = await pool.query(
		`INSERT INTO omni_scores (user_id, total_score, score_tier, version)
     VALUES ($1, $2, 'new', 2)
     RETURNING *`,
		[userId, SCORE_RANGES.MIN],
	);
	return result.rows[0];
}

/**
 * Calculate score on-demand (deterministic). Does NOT require explicit checkin.
 */
async function calculateScore(userId) {
	const { total, factors, fraudSignals, tier } = await computeFactors(userId);

	// Backwards-compat mapping to old columns
	const interview_score = Math.round(factors.interview_performance.raw);
	const technical_score = Math.round(factors.verified_skills.raw);
	const resume_score = Math.round(
		(factors.experience_quality.raw + factors.education_credentials.raw) / 2,
	);
	const behavior_score = Math.round(
		(factors.reliability_signals.raw + factors.soft_skills.raw) / 2,
	);

	// Compute peer percentile
	const percentileRes = await pool.query(
		`SELECT COUNT(*) FILTER (WHERE total_score <= $1) * 100.0 / NULLIF(COUNT(*), 0) as percentile
     FROM omni_scores`,
		[total],
	);
	const peerPercentile = Math.round(parseFloat(percentileRes.rows[0]?.percentile || '50'));

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
			total,
			interview_score,
			technical_score,
			resume_score,
			behavior_score,
			dbTierFromLabel(tier),
			JSON.stringify(
				Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Math.round(v.raw)])),
			),
			peerPercentile,
			JSON.stringify(fraudSignals),
			userId,
		],
	);

	// Weekly snapshot (idempotent — only one per week)
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
			JSON.stringify(
				Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Math.round(v.raw)])),
			),
			peerPercentile,
		],
	);

	return {
		total_score: total,
		interview: interview_score,
		technical: technical_score,
		resume: resume_score,
		behavior: behavior_score,
		tier,
		tier_label: SCORE_RANGES.TIERS[tier]?.label || 'New',
		peer_percentile: peerPercentile,
		fraud_signals: fraudSignals,
		factors: Object.fromEntries(
			Object.entries(factors).map(([k, v]) => [
				k,
				{ raw: Math.round(v.raw), weight: FACTOR_WEIGHTS[k], details: v.details },
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
			weight: FACTOR_WEIGHTS[key],
			weighted_contribution: Math.round(((factorData?.raw || 0) / 100) * FACTOR_WEIGHTS[key] * 550),
			label: meta.label,
			description: meta.description,
			details: factorData?.details || [],
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
		});
	}

	// Peer comparison
	const percentileRes = await pool.query(
		`SELECT
      PERCENT_RANK() WITHIN GROUP (ORDER BY total_score) * 100 as percentile,
      AVG(total_score) as avg_score,
      MAX(total_score) as top_score,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_score) as median_score
     FROM omni_scores`,
	);
	const peerStats = percentileRes.rows[0] || {};
	const userPercentile = scoreData.peer_percentile;

	return {
		factors: explainers.sort((a, b) => b.impact - a.impact),
		peerComparison: {
			percentile: userPercentile,
			avgScore: Math.round(parseFloat(peerStats.avg_score || '500')),
			topScore: Math.round(parseFloat(peerStats.top_score || '1000')),
			medianScore: Math.round(parseFloat(peerStats.median_score || '500')),
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
	SCORE_RANGES,
	FACTOR_WEIGHTS,
	FACTOR_META,
	getOrCreateScore,
	calculateScore,
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
