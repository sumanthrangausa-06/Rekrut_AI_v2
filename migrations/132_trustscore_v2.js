// TrustScore v2 Migration — Deep company scoring and accountability (Issue #122)
module.exports = {
	name: 'trustscore_v2',
	up: async (client) => {
		// ─── 1. Add v2 factor columns to trust_scores ──────────────────────────
		await client.query(`
      ALTER TABLE trust_scores
        ADD COLUMN IF NOT EXISTS employee_satisfaction_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS interview_experience_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS offer_acceptance_rate_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS time_to_hire_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS response_rate_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS salary_competitiveness_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS diversity_metrics_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS career_growth_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS data_sufficiency_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ai_summary TEXT,
        ADD COLUMN IF NOT EXISTS ai_summary_generated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS v2_calculated_at TIMESTAMP
    `);

		// ─── 2. New table: company review responses ────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS company_review_responses (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        review_id INTEGER REFERENCES company_ratings(id) ON DELETE CASCADE,
        responder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        response_text TEXT NOT NULL,
        is_public BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

		// ─── 3. New table: TrustScore methodology (published) ──────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS trustscore_methodology (
        id SERIAL PRIMARY KEY,
        version VARCHAR(20) NOT NULL DEFAULT '2.0',
        factor_name VARCHAR(100) NOT NULL,
        factor_key VARCHAR(50) NOT NULL,
        weight DECIMAL(4,3) NOT NULL,
        max_score INTEGER NOT NULL,
        description TEXT,
        data_source TEXT,
        calculation_method TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(version, factor_key)
      )
    `);

		// ─── 4. New table: candidate interview feedback (post-decision) ────────
		// This extends candidate_feedback with interview-specific details
		await client.query(`
      CREATE TABLE IF NOT EXISTS interview_feedback (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        interview_id INTEGER REFERENCES scheduled_interviews(id) ON DELETE SET NULL,
        overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
        interview_experience_rating INTEGER CHECK (interview_experience_rating >= 1 AND interview_experience_rating <= 5),
        communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
        transparency_rating INTEGER CHECK (transparency_rating >= 1 AND transparency_rating <= 5),
        professionalism_rating INTEGER CHECK (professionalism_rating >= 1 AND professionalism_rating <= 5),
        feedback_text TEXT,
        would_recommend BOOLEAN,
        is_anonymous BOOLEAN DEFAULT true,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

		// ─── 5. Indexes for leaderboard and lookups ────────────────────────────
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trust_scores_leaderboard
        ON trust_scores(total_score DESC, last_updated DESC)
        WHERE data_sufficiency_score >= 50;

      CREATE INDEX IF NOT EXISTS idx_trust_scores_tier
        ON trust_scores(score_tier, total_score DESC);

      CREATE INDEX IF NOT EXISTS idx_trust_scores_data_sufficiency
        ON trust_scores(company_id, data_sufficiency_score);

      CREATE INDEX IF NOT EXISTS idx_company_review_responses_company
        ON company_review_responses(company_id);

      CREATE INDEX IF NOT EXISTS idx_company_review_responses_review
        ON company_review_responses(review_id);

      CREATE INDEX IF NOT EXISTS idx_trustscore_methodology_active
        ON trustscore_methodology(version, is_active);

      CREATE INDEX IF NOT EXISTS idx_interview_feedback_company
        ON interview_feedback(company_id);

      CREATE INDEX IF NOT EXISTS idx_interview_feedback_candidate
        ON interview_feedback(candidate_id);

      CREATE INDEX IF NOT EXISTS idx_interview_feedback_ip
        ON interview_feedback(ip_address, created_at);
    `);

		// ─── 6. Seed methodology rows ──────────────────────────────────────────
		await client.query(`
      INSERT INTO trustscore_methodology (version, factor_name, factor_key, weight, max_score, description, data_source, calculation_method)
      VALUES
        ('2.0', 'Company Verification', 'verification', 0.080, 80, 'Email domain, LinkedIn, website confirmation', 'companies table', 'Binary checks: verified email domain (+30), LinkedIn linked (+25), website confirmed (+25)'),
        ('2.0', 'Job Authenticity', 'job_authenticity', 0.120, 120, 'Complete descriptions, realistic salary, clear requirements', 'jobs table + AI analysis', 'Per-job scoring: description length, salary range presence, requirement clarity'),
        ('2.0', 'Hiring Ratio', 'hiring_ratio', 0.120, 120, 'Interviews to offers conversion efficiency', 'job_applications + job_analytics', 'offers_made / interviews_scheduled, ideal 20-40%'),
        ('2.0', 'Candidate Feedback', 'feedback', 0.080, 80, 'Ratings from candidates who interviewed', 'candidate_feedback + company_ratings', 'Average of post-interview ratings (1-5 scale mapped to 0-80)'),
        ('2.0', 'Platform Behavior', 'behavior', 0.050, 50, 'Response times, profile completeness, activity', 'trust_score_components', 'Activity-based: profile completeness, response timeliness'),
        ('2.0', 'Employee Satisfaction', 'employee_satisfaction', 0.100, 100, 'Post-hire and post-interview satisfaction ratings', 'company_ratings.overall_rating', 'Average overall rating (1-5 scale mapped to 0-100)'),
        ('2.0', 'Interview Experience', 'interview_experience', 0.100, 100, 'Candidate reviews of the interview process', 'interview_feedback + company_ratings.interview_experience', 'Combined average of interview experience ratings'),
        ('2.0', 'Offer Acceptance Rate', 'offer_acceptance_rate', 0.075, 75, 'Percentage of offers that are accepted', 'offers table', 'accepted_offers / total_offers_sent * 75'),
        ('2.0', 'Time to Hire', 'time_to_hire', 0.050, 50, 'Speed from application to decision', 'job_applications', 'Median days from applied to status change (hired/rejected), faster = higher'),
        ('2.0', 'Response Rate', 'response_rate', 0.075, 75, 'Do companies reply to applications?', 'job_applications', 'Applications with non-applied status / total applications * 75'),
        ('2.0', 'Salary Competitiveness', 'salary_competitiveness', 0.050, 50, 'Offers against market rate for role/location', 'offers + jobs', 'Offer salary vs job posting range; above midpoint = higher'),
        ('2.0', 'Diversity Metrics', 'diversity_metrics', 0.000, 0, 'Representation across the pipeline', 'job_applications + users', 'Geographic diversity + pipeline stage distribution (placeholder — insufficient data)'),
        ('2.0', 'Career Growth', 'career_growth', 0.100, 100, 'Progression and growth opportunity for hires', 'company_ratings.growth_opportunity', 'Average growth opportunity rating (1-5 scale mapped to 0-100)')
      ON CONFLICT (version, factor_key) DO NOTHING;
    `);

		console.log('TrustScore v2 migration applied successfully');
	},
};
