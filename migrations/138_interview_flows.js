/**
 * Migration 138: interview_flows — generalized interview configuration (#322).
 *
 * Generalizes screening_templates into interview_flows so recruiters can define
 * screening AND AI-interview flows with phases, topics/questions, rubric
 * weights, and triggers ({manual, auto_send_on_apply}). The auto-send
 * threshold stays a job-level setting (jobSettings.auto_send_min_score);
 * triggers is JSONB so per-flow thresholds can be added later without a
 * schema change.
 *
 * screening_templates is NOT dropped: the auto-send hook and session creation
 * keep reading it during the transition (Task 10's recruiter UI cuts over to
 * interview_flows CRUD, then screening_templates can be removed).
 */
module.exports = {
	name: 'interview_flows',
	up: async (client) => {
		// Order-safety: this file sorts before p6_screening_template_topics.js,
		// so ensure the topics column exists before the backfill reads it.
		// Idempotent — p6's own ADD COLUMN IF NOT EXISTS is a no-op afterwards.
		await client.query(`
      ALTER TABLE screening_templates
      ADD COLUMN IF NOT EXISTS topics JSONB DEFAULT '[]'
    `);

		await client.query(`
      CREATE TABLE IF NOT EXISTS interview_flows (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'screening',
        description TEXT,
        phases JSONB NOT NULL DEFAULT '[]',
        topics JSONB NOT NULL DEFAULT '[]',
        questions JSONB NOT NULL DEFAULT '[]',
        rubric_weights JSONB NOT NULL DEFAULT '{}',
        triggers JSONB NOT NULL DEFAULT '{"manual": true}',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_flows_job
      ON interview_flows(job_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_flows_company
      ON interview_flows(company_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_flows_type
      ON interview_flows(type)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_interview_flows_status
      ON interview_flows(status)
    `);

		// Backfill: one active flow per active screening template (one-shot,
		// like the Task 1 backfill — guarded by _migrations tracking).
		// The auto-send threshold stays a job-level setting (single source of
		// truth in job settings); the flow records whether auto-send is on.
		// (Written as a JSON cast rather than jsonb_build_object(..., bool)
		// so the statement executes on every Postgres-compatible engine.)
		await client.query(`
      INSERT INTO interview_flows
        (company_id, job_id, created_by, name, type, description,
         phases, topics, questions, rubric_weights, triggers, status)
      SELECT
        company_id,
        job_id,
        created_by,
        title,
        'screening',
        description,
        '[]'::jsonb,
        COALESCE(topics, '[]'::jsonb),
        COALESCE(questions, '[]'::jsonb),
        '{}'::jsonb,
        ('{"manual": true, "auto_send_on_apply": '
          || COALESCE(auto_send_on_apply, false)::text || '}')::jsonb,
        status
      FROM screening_templates
      WHERE status = 'active'
    `);
	},
	down: async (client) => {
		await client.query(`DROP TABLE IF EXISTS interview_flows`);
	},
};
