const pool = require('../lib/db');

// ─── Constants ───────────────────────────────────────────────────────────

const WEIGHTS = {
	skills: 0.4,
	experience: 0.25,
	location: 0.15,
	salary: 0.1,
	job_type: 0.1,
};

const EXPERIENCE_LEVEL_YEARS = {
	entry: 1,
	junior: 2,
	mid: 4,
	senior: 7,
	lead: 9,
	principal: 10,
	staff: 10,
	manager: 7,
	director: 10,
	vp: 12,
	'c-level': 15,
	executive: 15,
};

const REMOTE_FLEXIBLE_TYPES = ['remote', 'flexible', 'hybrid'];

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a numeric "required years" from a job's experience_level text.
 */
function parseRequiredYears(experienceLevel) {
	if (!experienceLevel) return 0;
	const lower = String(experienceLevel).toLowerCase().trim();

	// Direct numeric extraction (e.g. "3+ years", "5 years")
	const numericMatch = lower.match(/(\d+)/);
	if (numericMatch) {
		return parseInt(numericMatch[1], 10);
	}

	// Map known keywords
	for (const [key, years] of Object.entries(EXPERIENCE_LEVEL_YEARS)) {
		if (lower.includes(key)) return years;
	}

	return 0;
}

/**
 * Normalise a skill name for comparison.
 */
function normaliseSkill(skill) {
	return String(skill)
		.toLowerCase()
		.replace(/[^a-z0-9+#.]/g, '')
		.trim();
}

/**
 * Compare candidate skills against job-required skills.
 * Returns { score, max, matched, missing }.
 */
function scoreSkills(candidateSkills, jobSkillsRequired) {
	if (!jobSkillsRequired || !Array.isArray(jobSkillsRequired) || jobSkillsRequired.length === 0) {
		return { score: 100, max: 100, matched: [], missing: [] };
	}

	const candidateMap = new Map();
	for (const cs of candidateSkills || []) {
		const name = normaliseSkill(cs.skill_name || cs.name || cs);
		const level = typeof cs.level === 'number' ? cs.level : parseInt(cs.level, 10) || 1;
		candidateMap.set(name, Math.max(level, candidateMap.get(name) || 0));
	}

	let totalCredits = 0;
	let earnedCredits = 0;
	const matched = [];
	const missing = [];

	for (const js of jobSkillsRequired) {
		const reqName = normaliseSkill(js);
		if (!reqName) continue;

		totalCredits += 1;
		const candidateLevel = candidateMap.get(reqName);
		if (candidateLevel !== undefined) {
			// level 3+ = full credit, 1-2 = half credit
			const credit = candidateLevel >= 3 ? 1 : 0.5;
			earnedCredits += credit;
			matched.push(js);
		} else {
			missing.push(js);
		}
	}

	if (totalCredits === 0) {
		return { score: 100, max: 100, matched: [], missing: [] };
	}

	const score = Math.round((earnedCredits / totalCredits) * 100);
	return { score, max: 100, matched, missing };
}

/**
 * Score experience match.
 */
function scoreExperience(candidateYears, requiredYears) {
	if (!requiredYears || requiredYears <= 0) {
		return { score: 100, max: 100, candidate_years: candidateYears, required_years: 0 };
	}
	if (!candidateYears || candidateYears <= 0) {
		return { score: 0, max: 100, candidate_years: 0, required_years: requiredYears };
	}

	const rawScore = Math.round((candidateYears / requiredYears) * 100);
	// Cap at 120% → overqualified still = 100
	const score = Math.min(100, rawScore);
	return { score, max: 100, candidate_years: candidateYears, required_years: requiredYears };
}

/**
 * Score location match.
 */
function scoreLocation(candidateProfile, job) {
	const jobLocation = (job.location || '').trim();
	const jobRemoteType = (job.remote_type || '').toLowerCase().trim();
	const candidateLocation = (candidateProfile.location || '').trim();
	const preferredLocations = candidateProfile.preferred_locations || [];
	const remotePreference = (candidateProfile.remote_preference || '').toLowerCase().trim();

	// 100 if remote_flexible or preferred_locations includes job location
	if (REMOTE_FLEXIBLE_TYPES.includes(jobRemoteType)) {
		return { score: 100, max: 100, match_type: 'remote_friendly' };
	}

	if (
		REMOTE_FLEXIBLE_TYPES.includes(remotePreference) &&
		REMOTE_FLEXIBLE_TYPES.includes(jobRemoteType)
	) {
		return { score: 100, max: 100, match_type: 'remote_friendly' };
	}

	// Check preferred_locations includes job location (case-insensitive partial match)
	const preferredArr = Array.isArray(preferredLocations)
		? preferredLocations
		: typeof preferredLocations === 'string'
			? [preferredLocations]
			: [];

	for (const pl of preferredArr) {
		if (
			pl &&
			(jobLocation.toLowerCase().includes(String(pl).toLowerCase().trim()) ||
				String(pl).toLowerCase().trim().includes(jobLocation.toLowerCase()))
		) {
			return { score: 100, max: 100, match_type: 'preferred_location' };
		}
	}

	// Exact location match
	if (candidateLocation && jobLocation.toLowerCase() === candidateLocation.toLowerCase()) {
		return { score: 100, max: 100, match_type: 'exact_match' };
	}

	// 50 if same country — best-effort: check if last segment (country) matches
	const jobParts = jobLocation
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const candParts = candidateLocation
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (
		jobParts.length > 0 &&
		candParts.length > 0 &&
		jobParts[jobParts.length - 1].toLowerCase() === candParts[candParts.length - 1].toLowerCase()
	) {
		return { score: 50, max: 100, match_type: 'same_country' };
	}

	return { score: 0, max: 100, match_type: 'mismatch' };
}

/**
 * Score salary match.
 */
function scoreSalary(candidateMin, jobSalaryMin, jobSalaryMax) {
	// If no candidate expectation, assume neutral
	if (candidateMin === null || candidateMin === undefined) {
		return {
			score: 50,
			max: 100,
			candidate_min: null,
			job_max: jobSalaryMax,
			job_min: jobSalaryMin,
		};
	}

	const cMin = parseInt(candidateMin, 10);
	if (Number.isNaN(cMin)) {
		return {
			score: 50,
			max: 100,
			candidate_min: null,
			job_max: jobSalaryMax,
			job_min: jobSalaryMin,
		};
	}

	const jMin =
		jobSalaryMin !== null && jobSalaryMin !== undefined ? parseInt(jobSalaryMin, 10) : null;
	const jMax =
		jobSalaryMax !== null && jobSalaryMax !== undefined ? parseInt(jobSalaryMax, 10) : null;

	// If no job salary data, neutral
	if ((jMin === null || Number.isNaN(jMin)) && (jMax === null || Number.isNaN(jMax))) {
		return { score: 50, max: 100, candidate_min: cMin, job_max: null, job_min: null };
	}

	// 100 if candidate min is within job range
	const effectiveMin = jMin !== null && !Number.isNaN(jMin) ? jMin : 0;
	const effectiveMax = jMax !== null && !Number.isNaN(jMax) ? jMax : Number.MAX_SAFE_INTEGER;

	if (cMin >= effectiveMin && cMin <= effectiveMax) {
		return { score: 100, max: 100, candidate_min: cMin, job_max: jMax, job_min: jMin };
	}

	// 50 if slightly below or above (within 20% tolerance)
	const tolerance = 0.2;
	const lowerBound = effectiveMin * (1 - tolerance);
	const upperBound = effectiveMax * (1 + tolerance);

	if (cMin >= lowerBound && cMin <= upperBound) {
		return { score: 50, max: 100, candidate_min: cMin, job_max: jMax, job_min: jMin };
	}

	return { score: 0, max: 100, candidate_min: cMin, job_max: jMax, job_min: jMin };
}

/**
 * Score job type match.
 */
function scoreJobType(candidatePreferredTypes, actualJobType) {
	const actual = (actualJobType || '').toLowerCase().trim();
	if (!actual) {
		return { score: 50, max: 100, preferred: candidatePreferredTypes, actual: null };
	}

	const preferredArr = Array.isArray(candidatePreferredTypes)
		? candidatePreferredTypes
		: typeof candidatePreferredTypes === 'string'
			? [candidatePreferredTypes]
			: [];

	const preferredLower = preferredArr.map((t) => String(t).toLowerCase().trim());

	if (preferredLower.includes(actual)) {
		return { score: 100, max: 100, preferred: preferredArr, actual: actualJobType };
	}

	// Partial match: contract vs freelance, part-time vs contract, etc.
	const partialMappings = {
		'full-time': ['contract', 'freelance'],
		'part-time': ['contract', 'freelance', 'internship'],
		contract: ['freelance', 'part-time', 'full-time'],
		freelance: ['contract', 'part-time'],
		internship: ['part-time'],
	};

	for (const pref of preferredLower) {
		const related = partialMappings[pref] || [];
		if (related.includes(actual)) {
			return { score: 50, max: 100, preferred: preferredArr, actual: actualJobType };
		}
	}

	return { score: 0, max: 100, preferred: preferredArr, actual: actualJobType };
}

/**
 * Generate a human-readable summary based on the fit score.
 */
/**
 * Score working-style preference match.
 * +10 if remote_type matches remote_preference
 * +10 if job_type is in preferred_job_types
 * +5  if salary ranges overlap
 */
function scorePreferences(candidateProfile, job) {
	let points = 0;
	const details = [];

	// Remote match
	const candidateRemote = (candidateProfile.remote_preference || '').toLowerCase().trim();
	const jobRemote = (job.remote_type || '').toLowerCase().trim();
	if (candidateRemote && jobRemote && candidateRemote === jobRemote) {
		points += 10;
		details.push('remote_match');
	}

	// Job type match
	const preferredTypes = candidateProfile.preferred_job_types || [];
	const actualJobType = (job.job_type || '').toLowerCase().trim();
	if (actualJobType && preferredTypes.length > 0) {
		const preferredLower = preferredTypes.map((t) => String(t).toLowerCase().trim());
		if (preferredLower.includes(actualJobType)) {
			points += 10;
			details.push('job_type_match');
		}
	}

	// Salary overlap
	const cMin = parseInt(candidateProfile.salary_min, 10);
	const cMax = parseInt(candidateProfile.salary_max, 10);
	const jMin =
		job.salary_min !== null && job.salary_min !== undefined ? parseInt(job.salary_min, 10) : null;
	const jMax =
		job.salary_max !== null && job.salary_max !== undefined ? parseInt(job.salary_max, 10) : null;

	if (!Number.isNaN(cMin) || !Number.isNaN(cMax)) {
		const candMin = Number.isNaN(cMin) ? 0 : cMin;
		const candMax = Number.isNaN(cMax) ? Number.MAX_SAFE_INTEGER : cMax;
		const jobMin = jMin !== null && !Number.isNaN(jMin) ? jMin : 0;
		const jobMax = jMax !== null && !Number.isNaN(jMax) ? jMax : Number.MAX_SAFE_INTEGER;

		// Overlap exists if max(lower bounds) <= min(upper bounds)
		if (Math.max(candMin, jobMin) <= Math.min(candMax, jobMax)) {
			points += 5;
			details.push('salary_overlap');
		}
	}

	return { score: points, max: 25, details };
}

function generateSummary(fitScore) {
	if (fitScore >= 90) return 'Excellent match — highly aligned with role requirements';
	if (fitScore >= 75) return 'Strong match — skills and experience align well';
	if (fitScore >= 60) return 'Good match — meets most key requirements';
	if (fitScore >= 45) return 'Fair match — some gaps but potential fit';
	if (fitScore >= 25) return 'Weak match — significant gaps in key areas';
	return 'Poor match — does not meet core requirements';
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Calculate a detailed fit score for a single candidate–job pair.
 *
 * @param {number} candidateId  – user.id of the candidate
 * @param {number} jobId        – jobs.id
 * @returns {Promise<object>}   – fit score object
 */
async function calculateFitScore(candidateId, jobId) {
	const client = await pool.connect();
	try {
		// Fetch candidate profile + skills in parallel
		const [profileResult, skillsResult] = await Promise.all([
			client.query(
				`
				SELECT
					cp.user_id,
					cp.years_experience,
					cp.location,
					cp.preferred_job_types,
					cp.preferred_locations,
					cp.remote_preference,
					cp.salary_min,
					cp.salary_max
				FROM candidate_profiles cp
				WHERE cp.user_id = $1
			`,
				[candidateId],
			),
			client.query(
				`
				SELECT skill_name, level
				FROM candidate_skills
				WHERE user_id = $1
			`,
				[candidateId],
			),
		]);

		const candidateProfile = profileResult.rows[0] || {};
		const candidateSkills = skillsResult.rows;

		// Fetch job
		const jobResult = await client.query(
			`
			SELECT
				id, title, company, location,
				salary_range, job_type, experience_level,
				skills_required, remote_type,
				salary_min, salary_max
			FROM jobs
			WHERE id = $1
		`,
			[jobId],
		);

		if (jobResult.rows.length === 0) {
			/** @type {any} */
			const err = new Error('Job not found');
			err.statusCode = 404;
			throw err;
		}

		const job = jobResult.rows[0];

		// Parse job skills_required JSONB
		let jobSkills = [];
		try {
			if (job.skills_required) {
				if (Array.isArray(job.skills_required)) {
					jobSkills = job.skills_required;
				} else if (typeof job.skills_required === 'string') {
					jobSkills = JSON.parse(job.skills_required);
				} else {
					jobSkills = job.skills_required;
				}
			}
		} catch (_e) {
			jobSkills = [];
		}

		// Parse candidate preferred_job_types
		let preferredJobTypes = [];
		try {
			if (candidateProfile.preferred_job_types) {
				if (Array.isArray(candidateProfile.preferred_job_types)) {
					preferredJobTypes = candidateProfile.preferred_job_types;
				} else if (typeof candidateProfile.preferred_job_types === 'string') {
					preferredJobTypes = JSON.parse(candidateProfile.preferred_job_types);
				} else {
					preferredJobTypes = candidateProfile.preferred_job_types;
				}
			}
		} catch (_e) {
			preferredJobTypes = [];
		}

		// Parse candidate preferred_locations
		let preferredLocations = [];
		try {
			if (candidateProfile.preferred_locations) {
				if (Array.isArray(candidateProfile.preferred_locations)) {
					preferredLocations = candidateProfile.preferred_locations;
				} else if (typeof candidateProfile.preferred_locations === 'string') {
					preferredLocations = JSON.parse(candidateProfile.preferred_locations);
				} else {
					preferredLocations = candidateProfile.preferred_locations;
				}
			}
		} catch (_e) {
			preferredLocations = [];
		}

		const candidateProfileNormalised = {
			...candidateProfile,
			preferred_job_types: preferredJobTypes,
			preferred_locations: preferredLocations,
		};

		// ─── Compute each dimension ───────────────────────────────────────

		const skillsBreakdown = scoreSkills(candidateSkills, jobSkills);
		const experienceBreakdown = scoreExperience(
			candidateProfile.years_experience || 0,
			parseRequiredYears(job.experience_level),
		);
		const locationBreakdown = scoreLocation(candidateProfileNormalised, job);
		const salaryBreakdown = scoreSalary(
			candidateProfile.salary_min,
			job.salary_min,
			job.salary_max,
		);
		const jobTypeBreakdown = scoreJobType(preferredJobTypes, job.job_type);

		// ─── Weighted total ───────────────────────────────────────────────

		const preferencesBreakdown = scorePreferences(candidateProfileNormalised, job);

		const weightedScore =
			skillsBreakdown.score * WEIGHTS.skills +
			experienceBreakdown.score * WEIGHTS.experience +
			locationBreakdown.score * WEIGHTS.location +
			salaryBreakdown.score * WEIGHTS.salary +
			jobTypeBreakdown.score * WEIGHTS.job_type +
			preferencesBreakdown.score;

		const fitScore = Math.round(Math.min(100, Math.max(0, weightedScore)));

		return {
			fit_score: fitScore,
			breakdown: {
				skills: skillsBreakdown,
				experience: experienceBreakdown,
				location: locationBreakdown,
				salary: salaryBreakdown,
				job_type: jobTypeBreakdown,
				preferences: preferencesBreakdown,
			},
			summary: generateSummary(fitScore),
		};
	} finally {
		client.release();
	}
}

/**
 * Calculate fit scores for a batch of jobs.
 * Uses Promise.all for parallel execution; each call reuses its own DB client
 * but the job queries are run in parallel for speed.
 *
 * @param {number}   candidateId
 * @param {number[]} jobIds
 * @returns {Promise<Array<{job_id: number, fit_score: number, breakdown: object, summary: string}>>}
 */
async function calculateFitScoresBatch(candidateId, jobIds) {
	if (!Array.isArray(jobIds) || jobIds.length === 0) {
		return [];
	}

	// Fetch candidate data once
	const client = await pool.connect();
	try {
		const [profileResult, skillsResult] = await Promise.all([
			client.query(
				`
				SELECT
					cp.user_id,
					cp.years_experience,
					cp.location,
					cp.preferred_job_types,
					cp.preferred_locations,
					cp.remote_preference,
					cp.salary_min,
					cp.salary_max
				FROM candidate_profiles cp
				WHERE cp.user_id = $1
			`,
				[candidateId],
			),
			client.query(`SELECT skill_name, level FROM candidate_skills WHERE user_id = $1`, [
				candidateId,
			]),
		]);

		const candidateProfile = profileResult.rows[0] || {};
		const candidateSkills = skillsResult.rows;

		// Fetch all jobs in a single query
		const jobResult = await client.query(
			`
			SELECT
				id, title, company, location,
				salary_range, job_type, experience_level,
				skills_required, remote_type,
				salary_min, salary_max
			FROM jobs
			WHERE id = ANY($1)
		`,
			[jobIds],
		);

		const jobsById = new Map(jobResult.rows.map((j) => [j.id, j]));

		// Parse candidate preferences once
		let preferredJobTypes = [];
		try {
			if (candidateProfile.preferred_job_types) {
				if (Array.isArray(candidateProfile.preferred_job_types)) {
					preferredJobTypes = candidateProfile.preferred_job_types;
				} else if (typeof candidateProfile.preferred_job_types === 'string') {
					preferredJobTypes = JSON.parse(candidateProfile.preferred_job_types);
				} else {
					preferredJobTypes = candidateProfile.preferred_job_types;
				}
			}
		} catch (_e) {
			preferredJobTypes = [];
		}

		let preferredLocations = [];
		try {
			if (candidateProfile.preferred_locations) {
				if (Array.isArray(candidateProfile.preferred_locations)) {
					preferredLocations = candidateProfile.preferred_locations;
				} else if (typeof candidateProfile.preferred_locations === 'string') {
					preferredLocations = JSON.parse(candidateProfile.preferred_locations);
				} else {
					preferredLocations = candidateProfile.preferred_locations;
				}
			}
		} catch (_e) {
			preferredLocations = [];
		}

		const candidateProfileNormalised = {
			...candidateProfile,
			preferred_job_types: preferredJobTypes,
			preferred_locations: preferredLocations,
		};

		// Compute each job score in parallel (pure CPU, no more DB calls)
		const results = jobIds.map((jobId) => {
			const job = jobsById.get(jobId);
			if (!job) {
				return {
					job_id: jobId,
					fit_score: 0,
					breakdown: null,
					summary: 'Job not found',
				};
			}

			let jobSkills = [];
			try {
				if (job.skills_required) {
					if (Array.isArray(job.skills_required)) {
						jobSkills = job.skills_required;
					} else if (typeof job.skills_required === 'string') {
						jobSkills = JSON.parse(job.skills_required);
					} else {
						jobSkills = job.skills_required;
					}
				}
			} catch (_e) {
				jobSkills = [];
			}

			const skillsBreakdown = scoreSkills(candidateSkills, jobSkills);
			const experienceBreakdown = scoreExperience(
				candidateProfile.years_experience || 0,
				parseRequiredYears(job.experience_level),
			);
			const locationBreakdown = scoreLocation(candidateProfileNormalised, job);
			const salaryBreakdown = scoreSalary(
				candidateProfile.salary_min,
				job.salary_min,
				job.salary_max,
			);
			const jobTypeBreakdown = scoreJobType(preferredJobTypes, job.job_type);

			const preferencesBreakdown = scorePreferences(candidateProfileNormalised, job);

			const weightedScore =
				skillsBreakdown.score * WEIGHTS.skills +
				experienceBreakdown.score * WEIGHTS.experience +
				locationBreakdown.score * WEIGHTS.location +
				salaryBreakdown.score * WEIGHTS.salary +
				jobTypeBreakdown.score * WEIGHTS.job_type +
				preferencesBreakdown.score;

			const fitScore = Math.round(Math.min(100, Math.max(0, weightedScore)));

			return {
				job_id: jobId,
				fit_score: fitScore,
				breakdown: {
					skills: skillsBreakdown,
					experience: experienceBreakdown,
					location: locationBreakdown,
					salary: salaryBreakdown,
					job_type: jobTypeBreakdown,
					preferences: preferencesBreakdown,
				},
				summary: generateSummary(fitScore),
			};
		});

		return results;
	} finally {
		client.release();
	}
}

module.exports = {
	calculateFitScore,
	calculateFitScoresBatch,
	WEIGHTS,
};
