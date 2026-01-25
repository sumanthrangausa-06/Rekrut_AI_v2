// Migration: Dynamic Assessment Engine
// Adds question bank, difficulty tracking, and anti-cheat detection

module.exports = {
  name: '006_dynamic_assessments',
  up: async (client) => {
    // Question bank for assessments
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_questions (
        id SERIAL PRIMARY KEY,
        skill_category VARCHAR(100) NOT NULL,
        difficulty_level INTEGER DEFAULT 2 CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
        question_type VARCHAR(50) NOT NULL,
        question_text TEXT NOT NULL,
        options JSONB,
        correct_answer TEXT,
        explanation TEXT,
        time_limit_seconds INTEGER DEFAULT 120,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Assessment sessions with anti-cheat tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        skill_id INTEGER REFERENCES candidate_skills(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'in_progress',
        current_question_index INTEGER DEFAULT 0,
        current_difficulty INTEGER DEFAULT 2,
        questions_asked JSONB DEFAULT '[]',
        answers_given JSONB DEFAULT '[]',
        score INTEGER DEFAULT 0,
        max_difficulty_reached INTEGER DEFAULT 2,
        tab_switches INTEGER DEFAULT 0,
        copy_paste_attempts INTEGER DEFAULT 0,
        time_anomalies INTEGER DEFAULT 0,
        suspicious_behavior JSONB DEFAULT '[]',
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Anti-cheat event log
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_events (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES assessment_sessions(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        event_data JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);

    // Update skill_assessments table to link to sessions
    await client.query(`
      ALTER TABLE skill_assessments
      ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES assessment_sessions(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS anti_cheat_score INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS behavioral_flags JSONB DEFAULT '[]'
    `);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assessment_questions_skill ON assessment_questions(skill_category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assessment_sessions_user ON assessment_sessions(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_assessment_events_session ON assessment_events(session_id)`);

    // Seed initial question bank with common tech/behavioral questions
    await client.query(`
      INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES
      ('JavaScript', 2, 'multiple_choice', 'What is the output of: console.log(typeof null)?',
       '["object", "null", "undefined", "number"]', 'object',
       'typeof null returns "object" - this is a known JavaScript quirk/bug that has been preserved for backwards compatibility.', 90),

      ('JavaScript', 3, 'multiple_choice', 'What will this code output: console.log(1 + "2" + 3)?',
       '["123", "6", "33", "Error"]', '123',
       'JavaScript type coercion: 1 + "2" becomes "12" (string), then "12" + 3 becomes "123".', 90),

      ('React', 2, 'multiple_choice', 'Which hook is used to perform side effects in React?',
       '["useEffect", "useState", "useMemo", "useCallback"]', 'useEffect',
       'useEffect is the React hook for handling side effects like data fetching, subscriptions, or DOM manipulation.', 60),

      ('Python', 2, 'multiple_choice', 'What is the correct way to create a list in Python?',
       '["[1, 2, 3]", "{1, 2, 3}", "(1, 2, 3)", "list(1, 2, 3)"]', '[1, 2, 3]',
       'Square brackets [] define a list in Python. Curly braces {} create a set, parentheses () create a tuple.', 60),

      ('Communication', 1, 'short_answer', 'Describe a time when you had to explain a complex technical concept to a non-technical stakeholder. How did you approach it?',
       NULL, NULL,
       'Look for clarity, patience, use of analogies, checking for understanding, and successful outcome.', 300),

      ('Problem Solving', 2, 'short_answer', 'You encounter a critical bug in production that affects 20% of users. Walk me through your debugging process.',
       NULL, NULL,
       'Good answers include: gather data, reproduce, isolate, hypothesize, test, fix, verify, document.', 240)
    `);

    console.log('Dynamic assessment tables created and seeded');
  }
};
