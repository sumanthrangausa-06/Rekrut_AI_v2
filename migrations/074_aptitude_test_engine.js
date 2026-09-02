/**
 * Migration 074: Aptitude Test Engine (Issue #111)
 * Timed, standardized cognitive aptitude test (like Crossover's CCAT).
 * 15 minutes, randomized questions, logic/verbal/numerical categories.
 */

exports.name = 'aptitude_test_engine';

exports.up = async (client) => {
	console.log('[migration] Creating aptitude test engine tables...');

	// ─── Aptitude Tests ─── Test definitions
	await client.query(`
    CREATE TABLE IF NOT EXISTS aptitude_tests (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 15 CHECK (duration_minutes > 0),
      pass_score INTEGER DEFAULT 60 CHECK (pass_score >= 0 AND pass_score <= 100),
      retake_lockout_days INTEGER DEFAULT 30 CHECK (retake_lockout_days >= 0),
      question_count INTEGER DEFAULT 50 CHECK (question_count > 0),
      is_active BOOLEAN DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// ─── Aptitude Questions ─── Question bank
	await client.query(`
    CREATE TABLE IF NOT EXISTS aptitude_questions (
      id SERIAL PRIMARY KEY,
      test_id INTEGER REFERENCES aptitude_tests(id) ON DELETE CASCADE,
      category VARCHAR(20) CHECK (category IN ('logic', 'verbal', 'numerical')) NOT NULL,
      difficulty INTEGER NOT NULL CHECK (difficulty >= 1 AND difficulty <= 5),
      question_text TEXT NOT NULL,
      options JSONB NOT NULL,
      correct_answer VARCHAR(255) NOT NULL,
      explanation TEXT,
      time_limit_seconds INTEGER DEFAULT 90 CHECK (time_limit_seconds > 0),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// ─── Aptitude Test Attempts ─── Candidate attempts
	await client.query(`
    CREATE TABLE IF NOT EXISTS aptitude_test_attempts (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      test_id INTEGER NOT NULL REFERENCES aptitude_tests(id) ON DELETE CASCADE,
      application_id INTEGER REFERENCES job_applications(id) ON DELETE SET NULL,
      status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'timed_out', 'abandoned')),
      answers JSONB DEFAULT '[]',
      score INTEGER,
      max_score INTEGER,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      time_spent_seconds INTEGER DEFAULT 0,
      tab_switches INTEGER DEFAULT 0,
      copy_paste_attempts INTEGER DEFAULT 0,
      time_anomalies INTEGER DEFAULT 0,
      anti_cheat_score INTEGER DEFAULT 100 CHECK (anti_cheat_score >= 0 AND anti_cheat_score <= 100),
      percentile NUMERIC(5,2),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	// ─── Aptitude Test Assignments ─── Job-test mapping
	await client.query(`
    CREATE TABLE IF NOT EXISTS aptitude_test_assignments (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      test_id INTEGER NOT NULL REFERENCES aptitude_tests(id) ON DELETE CASCADE,
      is_required BOOLEAN DEFAULT true,
      target_score_min INTEGER CHECK (target_score_min >= 0 AND target_score_min <= 100),
      target_score_max INTEGER CHECK (target_score_max >= 0 AND target_score_max <= 100),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (job_id, test_id)
    )
  `);

	// ─── Indexes ───
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_tests_active ON aptitude_tests(is_active) WHERE is_active = true`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_tests_created_by ON aptitude_tests(created_by)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_questions_test ON aptitude_questions(test_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_questions_category ON aptitude_questions(category)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_questions_active_cat ON aptitude_questions(is_active, category, difficulty)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_attempts_candidate ON aptitude_test_attempts(candidate_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_attempts_test ON aptitude_test_attempts(test_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_attempts_status ON aptitude_test_attempts(status)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_attempts_completed ON aptitude_test_attempts(test_id, completed_at) WHERE status = 'completed'`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_assignments_job ON aptitude_test_assignments(job_id)`,
	);
	await client.query(
		`CREATE INDEX IF NOT EXISTS idx_apt_assignments_test ON aptitude_test_assignments(test_id)`,
	);

	// ─── Seed: Default Aptitude Test ───
	const testResult = await client.query(
		`
    INSERT INTO aptitude_tests (title, description, duration_minutes, pass_score, retake_lockout_days, question_count, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `,
		[
			'Cognitive Aptitude Assessment',
			'A standardized 15-minute test measuring logical reasoning, verbal ability, and numerical problem-solving — similar to Crossover CCAT.',
			15,
			60,
			30,
			50,
			true,
		],
	);
	const testId = testResult.rows[0].id;

	// ─── Seed: 30 Questions (10 logic, 10 verbal, 10 numerical) ───
	const questions = [
		// ─── LOGIC (10) ───
		{
			category: 'logic',
			difficulty: 1,
			text: 'If all roses are flowers and some flowers fade quickly, then which statement must be true?',
			options: [
				'All roses fade quickly',
				'Some roses fade quickly',
				'No roses fade quickly',
				'Roses are not flowers',
			],
			answer: 'Some roses fade quickly',
			explanation:
				'Since all roses are flowers and some flowers fade quickly, it follows that some roses (being flowers) may fade quickly.',
		},
		{
			category: 'logic',
			difficulty: 1,
			text: 'Find the next number in the sequence: 2, 4, 8, 16, ...',
			options: ['24', '32', '30', '20'],
			answer: '32',
			explanation: 'Each number is multiplied by 2: 2×2=4, 4×2=8, 8×2=16, 16×2=32.',
		},
		{
			category: 'logic',
			difficulty: 2,
			text: 'A bat and a ball cost $11 in total. The bat costs $10 more than the ball. How much does the ball cost?',
			options: ['$1', '$0.50', '$2', '$1.50'],
			answer: '$0.50',
			explanation:
				'If the ball costs $0.50, the bat costs $10.50 ($10 more). $0.50 + $10.50 = $11.',
		},
		{
			category: 'logic',
			difficulty: 2,
			text: 'Which shape comes next in the pattern: ○, △, □, ○, △, ...',
			options: ['○', '△', '□', '◇'],
			answer: '□',
			explanation: 'The pattern repeats every 3 shapes: circle, triangle, square.',
		},
		{
			category: 'logic',
			difficulty: 3,
			text: 'If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?',
			options: ['5 minutes', '100 minutes', '20 minutes', '500 minutes'],
			answer: '5 minutes',
			explanation:
				'Each machine makes 1 widget in 5 minutes. 100 machines make 100 widgets in the same 5 minutes.',
		},
		{
			category: 'logic',
			difficulty: 3,
			text: 'In a lake, there is a patch of lily pads. Every day, the patch doubles in size. If it takes 48 days for the patch to cover the entire lake, how long would it take for the patch to cover half of the lake?',
			options: ['24 days', '47 days', '46 days', '12 days'],
			answer: '47 days',
			explanation:
				'Since the patch doubles every day, on day 47 it covers half the lake, and on day 48 it covers the entire lake.',
		},
		{
			category: 'logic',
			difficulty: 4,
			text: 'Three people check into a hotel room that costs $30. They each contribute $10. Later, the manager realizes the room is only $25 and gives $5 to the bellboy to return. The bellboy keeps $2 and gives $1 to each guest. Now each guest paid $9 ($27 total) and the bellboy has $2. Where is the missing dollar?',
			options: [
				"It is in the manager's pocket",
				'There is no missing dollar — the accounting is misleading',
				'The bellboy has it hidden',
				'It was never there',
			],
			answer: 'There is no missing dollar — the accounting is misleading',
			explanation:
				'The $27 includes the $25 room + $2 bellboy. Adding the $2 again is double-counting. The guests have $3 back. $25 + $2 + $3 = $30.',
		},
		{
			category: 'logic',
			difficulty: 4,
			text: 'All Zorgs are Yips. No Yips are Xams. Therefore:',
			options: [
				'Some Zorgs are Xams',
				'No Zorgs are Xams',
				'All Zorgs are Xams',
				'Some Yips are Zorgs',
			],
			answer: 'No Zorgs are Xams',
			explanation:
				'All Zorgs are Yips, and no Yips are Xams. Therefore no Zorgs can be Xams (transitive property).',
		},
		{
			category: 'logic',
			difficulty: 5,
			text: 'A farmer has 17 sheep and all but 9 die. How many sheep are left?',
			options: ['8', '9', '17', '0'],
			answer: '9',
			explanation:
				'"All but 9 die" means 9 survive. This is a trick question testing careful reading.',
		},
		{
			category: 'logic',
			difficulty: 5,
			text: "Four people need to cross a bridge at night. They have one torch. The bridge can only hold two people at a time. Their crossing times are: A=1min, B=2min, C=5min, D=10min. When two cross together, they move at the slower person's pace. What is the minimum total time for all to cross?",
			options: ['17 minutes', '19 minutes', '21 minutes', '23 minutes'],
			answer: '17 minutes',
			explanation:
				'A+B cross (2), A returns (1), C+D cross (10), B returns (2), A+B cross (2). Total: 2+1+10+2+2 = 17.',
		},

		// ─── VERBAL (10) ───
		{
			category: 'verbal',
			difficulty: 1,
			text: 'Choose the word that is most nearly OPPOSITE in meaning to: BENEVOLENT',
			options: ['Kind', 'Malevolent', 'Generous', 'Charitable'],
			answer: 'Malevolent',
			explanation:
				'Benevolent means well-meaning and kindly. Malevolent means having or showing a wish to do evil to others.',
		},
		{
			category: 'verbal',
			difficulty: 1,
			text: 'Which word best completes the analogy? Book is to Read as Song is to ___',
			options: ['Write', 'Sing', 'Dance', 'Compose'],
			answer: 'Sing',
			explanation: 'A book is read; a song is sung.',
		},
		{
			category: 'verbal',
			difficulty: 2,
			text: 'Choose the word that does NOT belong: Carpenter, Mason, Electrician, Baker',
			options: ['Carpenter', 'Mason', 'Electrician', 'Baker'],
			answer: 'Baker',
			explanation:
				'Carpenter, Mason, and Electrician are construction trades. Baker is a food profession.',
		},
		{
			category: 'verbal',
			difficulty: 2,
			text: 'Select the pair that best expresses a relationship similar to: DOCTOR : HOSPITAL',
			options: ['Teacher : School', 'Artist : Museum', 'Chef : Market', 'Driver : Highway'],
			answer: 'Teacher : School',
			explanation: 'A doctor works in a hospital; a teacher works in a school.',
		},
		{
			category: 'verbal',
			difficulty: 3,
			text: 'Rearrange these letters to form a meaningful word: R E S C U O',
			options: ['Course', 'Source', 'Cousre', 'Secour'],
			answer: 'Source',
			explanation: 'The letters R-E-S-C-U-O can be rearranged to form SOURCE.',
		},
		{
			category: 'verbal',
			difficulty: 3,
			text: 'Choose the word that best replaces the phrase in parentheses: The proposal was (rejected with contempt) by the committee.',
			options: ['Accepted', 'Approved', 'Spurned', 'Considered'],
			answer: 'Spurned',
			explanation: 'To spurn means to reject with contempt or disdain.',
		},
		{
			category: 'verbal',
			difficulty: 4,
			text: 'Choose the pair with the same relationship: EPHEMERAL : PERMANENCE',
			options: [
				'Arid : Moisture',
				'Erratic : Predictability',
				'Fervent : Apathy',
				'Taciturn : Silence',
			],
			answer: 'Erratic : Predictability',
			explanation:
				'Ephemeral is the opposite of permanence; erratic is the opposite of predictability.',
		},
		{
			category: 'verbal',
			difficulty: 4,
			text: 'Which sentence is grammatically correct?',
			options: [
				"Between you and I, the plan won't work.",
				'Between you and me, the plan will not work.',
				"Between you and me, the plan won't works.",
				'Between you and I, the plan will not works.',
			],
			answer: 'Between you and me, the plan will not work.',
			explanation:
				'"Between" is a preposition requiring the objective case (me, not I). "Will not work" is the correct verb form.',
		},
		{
			category: 'verbal',
			difficulty: 5,
			text: 'Choose the best meaning of: "The manager\'s parsimonious approach to budgeting stifled innovation."',
			options: [
				'The manager was generous with funds',
				'The manager was excessively frugal',
				'The manager delegated budgeting well',
				'The manager ignored the budget',
			],
			answer: 'The manager was excessively frugal',
			explanation:
				'Parsimonious means unwilling to spend money or use resources; stingy or frugal to excess.',
		},
		{
			category: 'verbal',
			difficulty: 5,
			text: 'Complete the sentence: "Although the CEO was known for his ___, his recent decisions have shown remarkable ___ ."',
			options: [
				'caution... recklessness',
				'impulsiveness... restraint',
				'generosity... stinginess',
				'humility... arrogance',
			],
			answer: 'impulsiveness... restraint',
			explanation:
				'The word "although" signals a contrast. The CEO was known for impulsiveness but showed restraint.',
		},

		// ─── NUMERICAL (10) ───
		{
			category: 'numerical',
			difficulty: 1,
			text: 'What is 15% of 200?',
			options: ['20', '25', '30', '35'],
			answer: '30',
			explanation: '15% of 200 = 0.15 × 200 = 30.',
		},
		{
			category: 'numerical',
			difficulty: 1,
			text: 'If 3 apples cost $6, how much do 5 apples cost?',
			options: ['$8', '$10', '$12', '$15'],
			answer: '$10',
			explanation: 'Each apple costs $6 ÷ 3 = $2. Five apples cost 5 × $2 = $10.',
		},
		{
			category: 'numerical',
			difficulty: 2,
			text: 'A store sells an item for $80 after a 20% discount. What was the original price?',
			options: ['$96', '$100', '$104', '$110'],
			answer: '$100',
			explanation:
				'If $80 is 80% of the original price (after 20% off), then original price = $80 ÷ 0.80 = $100.',
		},
		{
			category: 'numerical',
			difficulty: 2,
			text: 'What is the average of 12, 18, 24, and 30?',
			options: ['18', '20', '21', '22'],
			answer: '21',
			explanation: '(12 + 18 + 24 + 30) ÷ 4 = 84 ÷ 4 = 21.',
		},
		{
			category: 'numerical',
			difficulty: 3,
			text: 'A car travels 240 miles in 4 hours. If it increases its speed by 10 mph, how long will it take to travel 300 miles?',
			options: ['4 hours', '4.5 hours', '5 hours', '5.5 hours'],
			answer: '4.5 hours',
			explanation:
				'Original speed = 240 ÷ 4 = 60 mph. New speed = 70 mph. Time = 300 ÷ 70 ≈ 4.29 hours ≈ 4.5 hours.',
		},
		{
			category: 'numerical',
			difficulty: 3,
			text: 'If 8 workers can complete a job in 6 days, how many days will it take 12 workers to complete the same job?',
			options: ['3', '4', '5', '6'],
			answer: '4',
			explanation:
				'Total work = 8 workers × 6 days = 48 worker-days. With 12 workers: 48 ÷ 12 = 4 days.',
		},
		{
			category: 'numerical',
			difficulty: 4,
			text: 'A rectangle has a perimeter of 36 cm. If the length is twice the width, what is the area?',
			options: ['48 cm²', '72 cm²', '36 cm²', '24 cm²'],
			answer: '72 cm²',
			explanation:
				'Let width = w, length = 2w. Perimeter = 2(w + 2w) = 6w = 36, so w = 6. Length = 12. Area = 6 × 12 = 72 cm².',
		},
		{
			category: 'numerical',
			difficulty: 4,
			text: 'A number is increased by 25% and then decreased by 20%. What is the net percentage change?',
			options: ['0%', '+5%', '-5%', '+2.5%'],
			answer: '0%',
			explanation: 'If original = 100, after +25% = 125. Then -20% of 125 = 100. Net change = 0%.',
		},
		{
			category: 'numerical',
			difficulty: 5,
			text: 'In how many ways can 4 people be arranged in a row?',
			options: ['16', '24', '12', '8'],
			answer: '24',
			explanation: '4! = 4 × 3 × 2 × 1 = 24 permutations.',
		},
		{
			category: 'numerical',
			difficulty: 5,
			text: 'The sum of three consecutive even numbers is 54. What is the largest number?',
			options: ['16', '18', '20', '22'],
			answer: '20',
			explanation:
				'Let the numbers be x, x+2, x+4. Then 3x + 6 = 54, so x = 16. The numbers are 16, 18, 20. Largest = 20.',
		},
	];

	for (const q of questions) {
		await client.query(
			`
      INSERT INTO aptitude_questions
      (test_id, category, difficulty, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
			[
				testId,
				q.category,
				q.difficulty,
				q.text,
				JSON.stringify(q.options),
				q.answer,
				q.explanation,
				q.difficulty <= 2 ? 60 : q.difficulty <= 4 ? 90 : 120,
			],
		);
	}

	console.log(
		`[migration] Aptitude test engine tables created and ${questions.length} questions seeded`,
	);
};
