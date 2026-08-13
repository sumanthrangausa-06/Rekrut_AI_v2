// =============================================================================
// Migration: Code Sandbox — Self-Hosted Judge0 Execution Engine (Issue #117)
// =============================================================================
// Creates tables for tracking code submissions, test cases, and supported
// languages for Rekrut AI's technical assessment platform.
//
// Tables:
//   - sandbox_languages     : Supported languages and their Judge0 configs
//   - sandbox_submissions   : Every code submission with execution results
//   - sandbox_test_cases    : Test cases for auto-grading code submissions
//
// =============================================================================

module.exports = {
	name: '117_code_sandbox',
	up: async (client) => {
		// ────────────────────────────────────────────────────────────────────
		// sandbox_languages — Supported languages and Judge0 configuration
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS sandbox_languages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        slug VARCHAR(50) NOT NULL UNIQUE,
        judge0_id INTEGER NOT NULL,
        version VARCHAR(50),
        file_extension VARCHAR(20) NOT NULL,
        default_cpu_time_seconds INTEGER DEFAULT 5,
        default_memory_kb INTEGER DEFAULT 128000,
        default_max_output_size INTEGER DEFAULT 4096,
        is_active BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		// Seed default languages (Judge0 CE v1.13.1 language IDs)
		await client.query(`
      INSERT INTO sandbox_languages (name, slug, judge0_id, version, file_extension, default_cpu_time_seconds, default_memory_kb, display_order, is_active)
      VALUES
        ('Python 3',          'python',     71,  '3.8.1',   '.py',    5,  256000, 1,  true),
        ('JavaScript (Node)', 'javascript', 63,  '12.14.0', '.js',    5,  256000, 2,  true),
        ('Java',              'java',       62,  '13.0.1',  '.java',  10, 512000, 3,  true),
        ('C++',               'cpp',        54,  'GCC 9.2', '.cpp',   5,  256000, 4,  true),
        ('Go',                'go',         60,  '1.13.5',  '.go',    5,  256000, 5,  true),
        ('C',                 'c',          50,  'GCC 9.2', '.c',     5,  256000, 6,  true),
        ('TypeScript',        'typescript', 74,  '3.7.4',   '.ts',    5,  256000, 7,  true),
        ('Ruby',              'ruby',       72,  '2.7.0',   '.rb',    5,  256000, 8,  true),
        ('Rust',              'rust',       73,  '1.40.0',  '.rs',    5,  256000, 9,  true),
        ('PHP',               'php',        68,  '7.4.1',   '.php',   5,  256000, 10, true),
        ('Kotlin',            'kotlin',     78,  '1.3.50',  '.kt',    10, 512000, 11, true),
        ('Swift',             'swift',      83,  '5.1.3',   '.swift', 5,  256000, 12, true)
      ON CONFLICT (slug) DO NOTHING
    `);

		// ────────────────────────────────────────────────────────────────────
		// sandbox_submissions — Track every code submission and its result
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS sandbox_submissions (
        id SERIAL PRIMARY KEY,
        token VARCHAR(100) NOT NULL UNIQUE,

        -- Who submitted
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_role VARCHAR(50),

        -- Assessment context
        assessment_id INTEGER,
        assessment_attempt_id INTEGER,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,

        -- Code content
        language_id INTEGER NOT NULL REFERENCES sandbox_languages(id),
        source_code TEXT NOT NULL,
        stdin TEXT,

        -- Execution parameters
        cpu_time_seconds INTEGER DEFAULT 5,
        memory_kb INTEGER DEFAULT 128000,
        max_output_size INTEGER DEFAULT 4096,
        enable_network BOOLEAN DEFAULT false,

        -- Execution status ( mirrors Judge0 status IDs )
        status_id INTEGER,
        status_description VARCHAR(100),

        -- Execution results
        stdout TEXT,
        stderr TEXT,
        compile_output TEXT,
        exit_code INTEGER,
        wall_time_seconds NUMERIC(10,3),
        memory_used_kb INTEGER,
        output_size INTEGER,

        -- Auto-grading results
        test_cases_total INTEGER DEFAULT 0,
        test_cases_passed INTEGER DEFAULT 0,
        test_cases_failed INTEGER DEFAULT 0,
        score NUMERIC(5,2),
        passed BOOLEAN,
        grader_feedback JSONB DEFAULT '{}',

        -- Anti-cheat / audit
        ip_address INET,
        user_agent TEXT,
        tab_switches INTEGER DEFAULT 0,
        copy_paste_attempts INTEGER DEFAULT 0,

        -- Timestamps
        submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		// Indexes for sandbox_submissions
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_submissions_token ON sandbox_submissions(token)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_submissions_user ON sandbox_submissions(user_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_submissions_assessment ON sandbox_submissions(assessment_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_submissions_job ON sandbox_submissions(job_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_submissions_status ON sandbox_submissions(status_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_submissions_submitted ON sandbox_submissions(submitted_at)
    `);

		// ────────────────────────────────────────────────────────────────────
		// sandbox_test_cases — Test cases for auto-grading code
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS sandbox_test_cases (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER NOT NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,

        -- Test case data
        name VARCHAR(255) NOT NULL,
        description TEXT,
        stdin TEXT,
        expected_stdout TEXT,
        expected_exit_code INTEGER DEFAULT 0,
        is_hidden BOOLEAN DEFAULT false,

        -- Grading weight
        points INTEGER DEFAULT 10,
        order_index INTEGER DEFAULT 0,

        -- Metadata
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		// Indexes for sandbox_test_cases
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_test_cases_assessment ON sandbox_test_cases(assessment_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_test_cases_job ON sandbox_test_cases(job_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_test_cases_order ON sandbox_test_cases(assessment_id, order_index)
    `);

		// ────────────────────────────────────────────────────────────────────
		// Indexes for sandbox_languages
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_languages_slug ON sandbox_languages(slug) WHERE is_active = true
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sandbox_languages_judge0 ON sandbox_languages(judge0_id)
    `);

		console.log('[migration] Code sandbox tables created (Issue #117)');
	},
};
