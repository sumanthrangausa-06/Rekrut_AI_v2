/**
 * Migration 135: Background Check System
 * Issue #133 — Employment/education verification, discrepancy detection, reference checks
 *
 * Tables:
 * - employment_history: candidate-declared work history with reference contacts
 * - education_history: candidate-declared education with certificate uploads
 * - bg_verification_requests: verification workflow (employment, education, reference)
 * - reference_checks: structured reference questionnaire responses
 * - discrepancies: detected differences between declared and verified data
 */
module.exports = {
	name: '135_background_check',
	up: async (client) => {
		// ─── employment_history ──────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS employment_history (
        id            SERIAL PRIMARY KEY,
        candidate_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_name  VARCHAR(255) NOT NULL,
        job_title     VARCHAR(255) NOT NULL,
        start_date    DATE,
        end_date      DATE,
        is_current    BOOLEAN DEFAULT false,
        reference_name   VARCHAR(255),
        reference_email  VARCHAR(255),
        reference_phone  VARCHAR(50),
        description   TEXT,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employment_history_candidate
      ON employment_history(candidate_id, created_at DESC)
    `);

		// ─── education_history ───────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS education_history (
        id               SERIAL PRIMARY KEY,
        candidate_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        institution_name VARCHAR(255) NOT NULL,
        degree           VARCHAR(255),
        field_of_study   VARCHAR(255),
        start_date       DATE,
        end_date         DATE,
        is_current       BOOLEAN DEFAULT false,
        description      TEXT,
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_education_history_candidate
      ON education_history(candidate_id, created_at DESC)
    `);

		// ─── bg_verification_requests ────────────────────────────────────────
		// NOTE: named bg_verification_requests to avoid conflict with
		// migration 068 identity verification table (verification_requests)
		await client.query(`
      CREATE TABLE IF NOT EXISTS bg_verification_requests (
        id               SERIAL PRIMARY KEY,
        candidate_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type             VARCHAR(20) NOT NULL
          CHECK (type IN ('employment', 'education', 'reference')),
        target_id        INTEGER NOT NULL,
        status           VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'sent', 'responded', 'manual_review', 'verified', 'rejected')),
        sent_at          TIMESTAMP WITH TIME ZONE,
        responded_at     TIMESTAMP WITH TIME ZONE,
        verification_data JSONB DEFAULT '{}',
        notes            TEXT,
        response_token   VARCHAR(64) UNIQUE,
        target_email     VARCHAR(255),
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bg_verification_candidate
      ON bg_verification_requests(candidate_id, created_at DESC)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bg_verification_status
      ON bg_verification_requests(status, created_at DESC)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bg_verification_token
      ON bg_verification_requests(response_token)
      WHERE response_token IS NOT NULL
    `);

		// ─── reference_checks ────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS reference_checks (
        id                   SERIAL PRIMARY KEY,
        candidate_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        employment_history_id INTEGER REFERENCES employment_history(id) ON DELETE SET NULL,
        reference_name       VARCHAR(255) NOT NULL,
        reference_email      VARCHAR(255),
        reference_phone      VARCHAR(50),
        relationship         VARCHAR(100),
        questionnaire_responses JSONB DEFAULT '{}',
        summary              TEXT,
        status               VARCHAR(20) DEFAULT 'pending'
          CHECK (status IN ('pending', 'sent', 'responded', 'completed')),
        created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reference_checks_candidate
      ON reference_checks(candidate_id, created_at DESC)
    `);

		// ─── discrepancies ───────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS discrepancies (
        id                SERIAL PRIMARY KEY,
        verification_request_id INTEGER NOT NULL REFERENCES bg_verification_requests(id) ON DELETE CASCADE,
        field_name        VARCHAR(100) NOT NULL,
        declared_value    TEXT,
        verified_value    TEXT,
        severity          VARCHAR(10) NOT NULL
          CHECK (severity IN ('minor', 'major')),
        status            VARCHAR(20) NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'candidate_responded', 'resolved', 'dismissed')),
        candidate_response TEXT,
        resolved_at       TIMESTAMP WITH TIME ZONE,
        created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_discrepancies_verification
      ON discrepancies(verification_request_id, created_at DESC)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_discrepancies_status
      ON discrepancies(status, created_at DESC)
    `);

		console.log('[migration-135] Background check tables created');
	},

	down: async (client) => {
		await client.query('DROP TABLE IF EXISTS discrepancies');
		await client.query('DROP TABLE IF EXISTS reference_checks');
		await client.query('DROP TABLE IF EXISTS bg_verification_requests');
		await client.query('DROP TABLE IF EXISTS education_history');
		await client.query('DROP TABLE IF EXISTS employment_history');
		console.log('[migration-135] Background check tables dropped');
	},
};
