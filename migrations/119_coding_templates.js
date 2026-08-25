// =============================================================================
// Migration: Technical Test Templates and Auto-Grading System (Issue #119)
// =============================================================================
// Creates tables for coding templates, test cases, candidate submissions,
// and per-test-case scoring. Depends on the code sandbox (Issue #117).
//
// Tables:
//   - coding_templates    : Template library (predefined + custom)
//   - coding_test_cases   : Test cases (visible sample + hidden)
//   - coding_submissions  : Candidate submissions
//   - coding_scores       : Per-test-case scoring results
//
// =============================================================================

module.exports = {
	name: '119_coding_templates',
	up: async (client) => {
		// ────────────────────────────────────────────────────────────────────
		// coding_templates — Template library
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS coding_templates (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        role_type VARCHAR(50) NOT NULL CHECK (role_type IN ('frontend','backend','data','sql','algorithms')),
        difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
        language_support JSONB NOT NULL DEFAULT '[]',
        time_limit_seconds INTEGER DEFAULT 15,
        memory_limit_mb INTEGER DEFAULT 512,
        starter_code JSONB DEFAULT '{}',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_custom BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        deleted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_templates_role ON coding_templates(role_type) WHERE deleted_at IS NULL AND is_active = true
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_templates_difficulty ON coding_templates(difficulty) WHERE deleted_at IS NULL AND is_active = true
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_templates_custom ON coding_templates(is_custom, created_by) WHERE deleted_at IS NULL
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_templates_active ON coding_templates(is_active) WHERE deleted_at IS NULL
    `);

		// ────────────────────────────────────────────────────────────────────
		// coding_test_cases — Test cases for auto-grading
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS coding_test_cases (
        id SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES coding_templates(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        stdin TEXT,
        expected_output TEXT,
        is_hidden BOOLEAN DEFAULT false,
        weight INTEGER DEFAULT 10,
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_test_cases_template ON coding_test_cases(template_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_test_cases_hidden ON coding_test_cases(template_id, is_hidden)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_test_cases_order ON coding_test_cases(template_id, order_index)
    `);

		// ────────────────────────────────────────────────────────────────────
		// coding_submissions — Candidate submissions
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS coding_submissions (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_id INTEGER NOT NULL REFERENCES coding_templates(id) ON DELETE CASCADE,
        job_application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
        code_text TEXT,
        language VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','graded')),
        score NUMERIC(5,2),
        max_score INTEGER DEFAULT 0,
        ai_review_text TEXT,
        plagiarism_flag BOOLEAN DEFAULT false,
        plagiarism_similarity NUMERIC(5,2),
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        submitted_at TIMESTAMP WITH TIME ZONE,
        graded_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_submissions_candidate ON coding_submissions(candidate_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_submissions_template ON coding_submissions(template_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_submissions_app ON coding_submissions(job_application_id) WHERE job_application_id IS NOT NULL
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_submissions_status ON coding_submissions(status)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_submissions_graded ON coding_submissions(graded_at)
    `);

		// ────────────────────────────────────────────────────────────────────
		// coding_scores — Per-test-case scoring
		// ────────────────────────────────────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS coding_scores (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES coding_submissions(id) ON DELETE CASCADE,
        test_case_id INTEGER NOT NULL REFERENCES coding_test_cases(id) ON DELETE CASCADE,
        passed BOOLEAN NOT NULL DEFAULT false,
        actual_output TEXT,
        execution_time_ms NUMERIC(10,3),
        memory_used_mb NUMERIC(10,3),
        score_earned INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(submission_id, test_case_id)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_scores_submission ON coding_scores(submission_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_coding_scores_testcase ON coding_scores(test_case_id)
    `);

		// ────────────────────────────────────────────────────────────────────
		// Seed Data: 5 predefined templates (one per role type)
		// ────────────────────────────────────────────────────────────────────

		// Template 1: Frontend — Build a Counter Component
		const t1Starter = JSON.stringify({
			javascript: 'function counter(initialValue = 0) {\n  // Your code here\n}',
			typescript: 'function counter(initialValue: number = 0): { increment: () => number; decrement: () => number; reset: () => number; getValue: () => number } {\n  // Your code here\n}'
		});
		const t1 = await client.query(`
      INSERT INTO coding_templates (title, description, role_type, difficulty, language_support, time_limit_seconds, memory_limit_mb, starter_code, is_custom, is_active)
      VALUES (
        'Build a Counter Component',
        'Create a simple counter component with increment, decrement, and reset functionality. The component should handle edge cases gracefully.',
        'frontend',
        'easy',
        '["javascript","typescript"]',
        10,
        256,
        $1,
        false,
        true
      )
      RETURNING id
    `, [t1Starter]);
		const t1Id = t1.rows[0].id;

		await client.query(`
      INSERT INTO coding_test_cases (template_id, name, description, stdin, expected_output, is_hidden, weight, order_index)
      VALUES
        ($1, 'Default counter starts at 0', 'Counter should initialize to 0 by default', '', '{"value":0}', false, 10, 0),
        ($1, 'Counter starts at custom value', 'Counter should accept an initial value', '5', '{"value":5}', false, 10, 1),
        ($1, 'Increment works', 'Counter should increment correctly', '', '{"increment":1,"value":1}', true, 15, 2),
        ($1, 'Decrement works', 'Counter should decrement correctly', '', '{"decrement":-1,"value":-1}', true, 15, 3),
        ($1, 'Reset works', 'Counter should reset to initial value', '10', '{"reset":10}', true, 20, 4)
    `, [t1Id]);

		// Template 2: Backend — REST API Rate Limiter
		const t2Starter = JSON.stringify({
			javascript: 'class RateLimiter {\n  constructor(maxRequests, windowMs) {\n    this.maxRequests = maxRequests;\n    this.windowMs = windowMs;\n    this.requests = new Map();\n  }\n  isAllowed(ip) {\n    // Your code here\n  }\n}',
			python: 'class RateLimiter:\n    def __init__(self, max_requests, window_ms):\n        self.max_requests = max_requests\n        self.window_ms = window_ms\n        self.requests = {}\n    def is_allowed(self, ip):\n        # Your code here\n        pass',
			java: 'public class RateLimiter {\n    private int maxRequests;\n    private long windowMs;\n    public RateLimiter(int maxRequests, long windowMs) {\n        this.maxRequests = maxRequests;\n        this.windowMs = windowMs;\n    }\n    public boolean isAllowed(String ip) {\n        // Your code here\n        return true;\n    }\n}',
			go: 'type RateLimiter struct {\n    maxRequests int\n    windowMs    int64\n    requests    map[string][]int64\n}\nfunc NewRateLimiter(maxRequests int, windowMs int64) *RateLimiter {\n    return &RateLimiter{maxRequests: maxRequests, windowMs: windowMs, requests: make(map[string][]int64)}\n}\nfunc (rl *RateLimiter) IsAllowed(ip string) bool {\n    // Your code here\n    return true\n}'
		});
		const t2 = await client.query(`
      INSERT INTO coding_templates (title, description, role_type, difficulty, language_support, time_limit_seconds, memory_limit_mb, starter_code, is_custom, is_active)
      VALUES (
        'REST API Rate Limiter',
        'Implement a simple in-memory rate limiter that tracks requests per IP address within a sliding time window. Return whether a request should be allowed or blocked.',
        'backend',
        'medium',
        '["javascript","python","java","go"]',
        15,
        512,
        $1,
        false,
        true
      )
      RETURNING id
    `, [t2Starter]);
		const t2Id = t2.rows[0].id;

		await client.query(`
      INSERT INTO coding_test_cases (template_id, name, description, stdin, expected_output, is_hidden, weight, order_index)
      VALUES
        ($1, 'First request allowed', 'Single request should always be allowed', '192.168.1.1', 'true', false, 10, 0),
        ($1, 'Within limit', 'Requests under max limit are allowed', '192.168.1.1,5,true', 'true', false, 10, 1),
        ($1, 'Exceeds limit blocked', 'Requests over max limit are blocked', '192.168.1.1,11,false', 'false', true, 20, 2),
        ($1, 'Different IPs independent', 'Rate limits are per-IP', '192.168.1.1,10,true;10.0.0.1,10,true', 'true;true', true, 20, 3),
        ($1, 'Window slides', 'Old requests outside window are forgotten', '192.168.1.1,6,true', 'true', true, 20, 4)
    `, [t2Id]);

		// Template 3: Data — Process CSV Data
		const t3Starter = JSON.stringify({
			python: "import csv\nfrom io import StringIO\n\ndef process_sales(csv_data):\n    \"\"\"Process sales CSV and return summary stats.\"\"\"\n    # Your code here\n    return {\n        'total_revenue': 0,\n        'best_selling_product': '',\n        'average_order_value': 0.0\n    }",
			javascript: 'function processSales(csvData) {\n  // Your code here\n  return {\n    totalRevenue: 0,\n    bestSellingProduct: \'\',\n    averageOrderValue: 0.0\n  };\n}',
			sql: '-- Write a SQL query that processes a sales table\n-- Table: sales (product VARCHAR, quantity INT, price DECIMAL)\n-- Return: total_revenue, best_selling_product, avg_order_value\nSELECT \n  -- Your code here\nFROM sales;'
		});
		const t3 = await client.query(`
      INSERT INTO coding_templates (title, description, role_type, difficulty, language_support, time_limit_seconds, memory_limit_mb, starter_code, is_custom, is_active)
      VALUES (
        'CSV Sales Report Processor',
        'Write a function that processes a CSV string of sales data (product,quantity,price) and returns total revenue, best-selling product, and average order value.',
        'data',
        'medium',
        '["python","javascript","sql"]',
        15,
        512,
        $1,
        false,
        true
      )
      RETURNING id
    `, [t3Starter]);
		const t3Id = t3.rows[0].id;

		await client.query(`
      INSERT INTO coding_test_cases (template_id, name, description, stdin, expected_output, is_hidden, weight, order_index)
      VALUES
        ($1, 'Empty data', 'Empty CSV returns zero values', '', '{"total_revenue":0,"best_selling_product":"","average_order_value":0}', false, 10, 0),
        ($1, 'Single row', 'Single row calculates correctly', 'Widget,5,10.00', '{"total_revenue":50.00,"best_selling_product":"Widget","average_order_value":50.00}', false, 10, 1),
        ($1, 'Multiple products', 'Multiple rows aggregate correctly', 'Widget,2,10.00\nGadget,3,20.00\nWidget,1,10.00', '{"total_revenue":90.00,"best_selling_product":"Widget","average_order_value":30.00}', true, 20, 2),
        ($1, 'Best seller by quantity', 'Best seller determined by total quantity', 'A,100,1.00\nB,50,2.00', '{"total_revenue":200.00,"best_selling_product":"A","average_order_value":100.00}', true, 20, 3),
        ($1, 'Decimal precision', 'Handles decimal prices correctly', 'Item,3,9.99', '{"total_revenue":29.97,"best_selling_product":"Item","average_order_value":29.97}', true, 20, 4)
    `, [t3Id]);

		// Template 4: SQL — Employee Department Analysis
		const t4Starter = JSON.stringify({
			sql: '-- Tables:\n-- employees(id INT, name VARCHAR, department_id INT, salary DECIMAL, hire_date DATE)\n-- departments(id INT, name VARCHAR, budget DECIMAL)\n\n-- Q1: List departments with avg salary > 50000\nSELECT \n  -- Your code here\nFROM departments d\nJOIN employees e ON d.id = e.department_id\nGROUP BY d.id;\n\n-- Q2: Find the 3 highest paid employees per department\nWITH ranked AS (\n  SELECT *,\n    -- Your code here\n  FROM employees\n)\nSELECT * FROM ranked WHERE rank <= 3;\n\n-- Q3: Find departments where total salary exceeds budget\nSELECT \n  -- Your code here\nFROM departments d\nJOIN employees e ON d.id = e.department_id;'
		});
		const t4 = await client.query(`
      INSERT INTO coding_templates (title, description, role_type, difficulty, language_support, time_limit_seconds, memory_limit_mb, starter_code, is_custom, is_active)
      VALUES (
        'Employee Department Analysis',
        'Write SQL queries to analyze employee data across departments. Given tables: employees(id, name, department_id, salary, hire_date) and departments(id, name, budget).',
        'sql',
        'medium',
        '["sql"]',
        15,
        256,
        $1,
        false,
        true
      )
      RETURNING id
    `, [t4Starter]);
		const t4Id = t4.rows[0].id;

		await client.query(`
      INSERT INTO coding_test_cases (template_id, name, description, stdin, expected_output, is_hidden, weight, order_index)
      VALUES
        ($1, 'Avg salary query', 'Find departments with avg salary above threshold', '50000', 'Engineering,75000|Marketing,55000', false, 15, 0),
        ($1, 'Top N per group', 'Get top 3 employees per department by salary', '3', 'Engineering:Alice,Bob,Carol|Sales:Dave,Eve', false, 15, 1),
        ($1, 'Budget overrun', 'Find departments exceeding budget', '', 'Marketing', true, 20, 2),
        ($1, 'Long tenure bonus', 'Find employees with >5 years tenure and salary < dept avg', '', 'Frank|Grace', true, 25, 3),
        ($1, 'Dept headcount', 'Count employees and total salary per department, ordered by total desc', '', 'Engineering,5,375000|Sales,3,180000|Marketing,2,110000', true, 25, 4)
    `, [t4Id]);

		// Template 5: Algorithms — Two Sum
		const t5Starter = JSON.stringify({
			python: 'def two_sum(nums, target):\n    """Return indices of two numbers that add to target."""\n    # Your code here\n    return []',
			javascript: 'function twoSum(nums, target) {\n  // Your code here\n  return [];\n}',
			java: 'public class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // Your code here\n        return new int[0];\n    }\n}',
			cpp: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        // Your code here\n        return {};\n    }\n};',
			go: 'func twoSum(nums []int, target int) []int {\n    // Your code here\n    return nil\n}'
		});
		const t5 = await client.query(`
      INSERT INTO coding_templates (title, description, role_type, difficulty, language_support, time_limit_seconds, memory_limit_mb, starter_code, is_custom, is_active)
      VALUES (
        'Two Sum',
        'Given an array of integers and a target sum, return indices of the two numbers that add up to the target. You may assume each input has exactly one solution, and you may not use the same element twice. Optimize for O(n) time complexity.',
        'algorithms',
        'easy',
        '["python","javascript","java","cpp","go"]',
        10,
        256,
        $1,
        false,
        true
      )
      RETURNING id
    `, [t5Starter]);
		const t5Id = t5.rows[0].id;

		await client.query(`
      INSERT INTO coding_test_cases (template_id, name, description, stdin, expected_output, is_hidden, weight, order_index)
      VALUES
        ($1, 'Basic case', 'Simple two sum', '2,7,11,15\n9', '0,1', false, 10, 0),
        ($1, 'Negative numbers', 'Handles negative integers', '-1,-2,-3,-4,-5\n-8', '2,4', false, 10, 1),
        ($1, 'Same value different indices', 'Values can repeat', '3,2,4\n6', '1,2', true, 20, 2),
        ($1, 'Large array', 'Efficient for large inputs', '1..10000\n19999', '9998,9999', true, 25, 3),
        ($1, 'Zero sum', 'Target is zero', '0,4,3,0\n0', '0,3', true, 20, 4)
    `, [t5Id]);

		console.log('[migration] Coding templates and auto-grading system created (Issue #119)');
	},
};
