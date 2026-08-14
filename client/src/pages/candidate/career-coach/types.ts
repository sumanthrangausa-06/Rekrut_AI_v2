export interface CareerPathway {
	pathway_name: string
	steps: Array<{
		step_number: number
		role: string
		timeframe: string
		required_skills: string[]
		skills_to_acquire: string[]
		avg_salary_range: string
		confidence: 'high' | 'medium' | 'low'
		grounded_jobs: Array<{ job_id: number; title: string; company: string }>
		action_items: string[]
	}>
	overall_confidence: 'high' | 'medium' | 'low'
	market_trend: 'growing' | 'stable' | 'declining'
}

export interface SkillGap {
	skill: string
	current_level: number
	required_level: number
	gap: string
	priority: 'critical' | 'high' | 'medium' | 'low'
	jobs_requiring_it: Array<{ job_id: number; title: string; company: string }>
}

export interface LearningStep {
	order: number
	title: string
	type: 'course' | 'project' | 'certification' | 'book' | 'practice' | 'community'
	description: string
	skill_tags: string[]
	resource_suggestions: Array<{
		name: string
		type: 'course' | 'book' | 'video' | 'documentation'
		url_hint: string
		free: boolean
	}>
	estimated_hours: number
	prerequisites: string[]
	deliverable: string
}

export interface CompanyBrief {
	summary: string
	culture: {
		overview: string
		work_life_balance: string
		growth_opportunities: string
		diversity_inclusion: string
	}
	interview_process: {
		stages: string[]
		typical_timeline: string
		tips: string[]
	}
	salary_benchmarks: {
		range_for_role: string
		negotiation_leverage: string[]
		benefits_notes: string
	}
	trustscore_analysis: {
		score: number
		tier: string
		strengths: string[]
		concerns: string[]
		red_flags: string[]
	}
	recommended_questions: Array<{
		category: string
		question: string
		why_ask: string
	}>
	competitor_comparison: string
	verdict: 'strong_recommend' | 'recommend' | 'caution' | 'avoid'
}

export interface ApplicationOptimization {
	optimized_cover_letter: string
	optimized_answers: Array<{
		question: string
		original: string
		optimized: string
		improvement: string
	}>
	diff_highlights: Array<{
		type: 'add' | 'remove' | 'keep' | 'rewrite'
		text: string
		reason: string
	}>
	score_before: number
	score_after: number
	feedback: {
		strengths: string[]
		weaknesses: string[]
		key_improvements: string[]
		tailoring: string
	}
}

export interface SalaryPracticeMessage {
	role: 'user' | 'ai'
	text: string
	timestamp: string
}

export interface CoachingFeedback {
	this_move: {
		score: number
		what_worked: string[]
		what_to_improve: string[]
	}
	tactics_used: string[]
	suggested_next_move: string
	negotiation_health: 'strong' | 'good' | 'neutral' | 'weak' | 'collapsing'
}

export interface SessionHistoryItem {
	id: number
	type: string
	status: string
	createdAt: string
	updatedAt: string
	inputData: Record<string, unknown>
	resultSummary: string | null
}
