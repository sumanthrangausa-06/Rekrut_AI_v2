/**
 * Market Skill Benchmarks — Static seed data for career diagnosis
 * GitHub Issue #77
 *
 * ponytail: Static JSON data is fine for MVP. No need for a DB table.
 * 4 roles × 3 levels = 12 benchmark profiles across 6 dimensions.
 *
 * Dimensions:
 *   - problem_solving
 *   - execution
 *   - communication
 *   - leadership
 *   - strategic_thinking
 *   - stakeholder_management
 *
 * Scores are 0-100 representing expected market-competitive level.
 */

const ROLES = ['Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer'];

const LEVELS = ['junior', 'mid', 'senior'];

// Dimension weights for each role (how important each dimension is for that role)
const ROLE_DIMENSION_WEIGHTS = {
	'Software Engineer': {
		problem_solving: 1.3,
		execution: 1.2,
		communication: 0.8,
		leadership: 0.7,
		strategic_thinking: 0.9,
		stakeholder_management: 0.6,
	},
	'Product Manager': {
		problem_solving: 1.1,
		execution: 1.1,
		communication: 1.3,
		leadership: 1.0,
		strategic_thinking: 1.2,
		stakeholder_management: 1.3,
	},
	'Data Scientist': {
		problem_solving: 1.3,
		execution: 0.9,
		communication: 0.8,
		leadership: 0.6,
		strategic_thinking: 1.1,
		stakeholder_management: 0.7,
	},
	'UX Designer': {
		problem_solving: 1.1,
		execution: 1.0,
		communication: 1.1,
		leadership: 0.7,
		strategic_thinking: 1.0,
		stakeholder_management: 0.9,
	},
};

// Base benchmarks per role × level
// Scores represent the market expectation for a competent professional at that level.
const BENCHMARKS = {
	'Software Engineer': {
		junior: {
			problem_solving: 55,
			execution: 50,
			communication: 45,
			leadership: 30,
			strategic_thinking: 35,
			stakeholder_management: 30,
		},
		mid: {
			problem_solving: 75,
			execution: 75,
			communication: 65,
			leadership: 55,
			strategic_thinking: 60,
			stakeholder_management: 55,
		},
		senior: {
			problem_solving: 90,
			execution: 88,
			communication: 80,
			leadership: 80,
			strategic_thinking: 85,
			stakeholder_management: 80,
		},
	},
	'Product Manager': {
		junior: {
			problem_solving: 50,
			execution: 50,
			communication: 55,
			leadership: 40,
			strategic_thinking: 45,
			stakeholder_management: 50,
		},
		mid: {
			problem_solving: 70,
			execution: 72,
			communication: 75,
			leadership: 65,
			strategic_thinking: 70,
			stakeholder_management: 75,
		},
		senior: {
			problem_solving: 85,
			execution: 88,
			communication: 92,
			leadership: 85,
			strategic_thinking: 90,
			stakeholder_management: 92,
		},
	},
	'Data Scientist': {
		junior: {
			problem_solving: 55,
			execution: 45,
			communication: 40,
			leadership: 25,
			strategic_thinking: 40,
			stakeholder_management: 30,
		},
		mid: {
			problem_solving: 78,
			execution: 68,
			communication: 60,
			leadership: 50,
			strategic_thinking: 65,
			stakeholder_management: 55,
		},
		senior: {
			problem_solving: 92,
			execution: 82,
			communication: 75,
			leadership: 70,
			strategic_thinking: 85,
			stakeholder_management: 75,
		},
	},
	'UX Designer': {
		junior: {
			problem_solving: 50,
			execution: 50,
			communication: 50,
			leadership: 30,
			strategic_thinking: 45,
			stakeholder_management: 40,
		},
		mid: {
			problem_solving: 70,
			execution: 72,
			communication: 72,
			leadership: 55,
			strategic_thinking: 68,
			stakeholder_management: 65,
		},
		senior: {
			problem_solving: 85,
			execution: 88,
			communication: 88,
			leadership: 78,
			strategic_thinking: 85,
			stakeholder_management: 85,
		},
	},
};

const DIMENSION_LABELS = {
	problem_solving: 'Problem Solving',
	execution: 'Execution',
	communication: 'Communication',
	leadership: 'Leadership',
	strategic_thinking: 'Strategic Thinking',
	stakeholder_management: 'Stakeholder Management',
};

function getBenchmark(role, level) {
	return BENCHMARKS[role]?.[level] || null;
}

function getAllBenchmarks() {
	return BENCHMARKS;
}

function getRoles() {
	return ROLES;
}

function getLevels() {
	return LEVELS;
}

function getDimensionLabels() {
	return DIMENSION_LABELS;
}

function getRoleWeights(role) {
	return ROLE_DIMENSION_WEIGHTS[role] || {};
}

module.exports = {
	BENCHMARKS,
	ROLE_DIMENSION_WEIGHTS,
	DIMENSION_LABELS,
	ROLES,
	LEVELS,
	getBenchmark,
	getAllBenchmarks,
	getRoles,
	getLevels,
	getDimensionLabels,
	getRoleWeights,
};
