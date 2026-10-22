// =============================================================================
// Migration 279: assessment catalogue — subjects, topics, sets (issue #1652,
// #1603 Phase C story C0)
// =============================================================================
//
// Design: docs/sdlc/rekrut-ai-v2/03-solutioning/sumanth-batch-2026-10-21/
// architecture-assessments-phase-c.md §3.1–§3.3, §6 step 1–2.
//
// Creates the catalogue-as-data layer that replaces the SKILL_CATALOG code
// constant (routes/assessments.js:29–142) as the system of record:
//   - assessment_subjects        (§3.1) — 19 subjects seeded below
//   - assessment_topics          (§3.2) — one default topic per legacy skill
//   - assessment_sets            (§3.3) — named reusable question selections
//   - assessment_set_questions   (§3.3) — ordered set membership
//
// §3.2 uniqueness rule (SF-8): legacy_skill_name is set ONLY on a subject's
// default topic, enforced mechanically by the partial unique index
// uq_assessment_topics_legacy_skill_name — the migration 280 backfill join
// can therefore match at most one topic per legacy name.
//
// Seed (§6 step 2, SF-7): subjects/default topics are inserted from
// SKILL_CATALOG verbatim (name, category, icon, description, order), with
// two design-ruled exceptions:
//   - HTML/CSS is the §3.1 display rename of legacy 'CSS & HTML' — the
//     subject carries the new display name and slug 'html-css', while its
//     default topic keeps legacy_skill_name = 'CSS & HTML' so the bank
//     backfill still matches.
//   - Aptitude (§3.1 disposition) seeds INACTIVE: it stays on its existing
//     aptitude engine/surface and does not appear in the Phase C catalogue.
// Net-new subjects DSA / OOP seed active with NO topics: §3.2 defines
// default topics only for the 16 legacy skills, and a topic with no bank
// behind it must never be seeded active-and-empty (§3.2 / §7 rule 2) —
// the catalogue renders them with the honest empty state (§4.1).
// No sets are seeded: pool mode is the only mode at first ship (§3.3).
//
// EXPAND-ONLY: four new tables and their indexes; nothing existing is
// touched. Every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, so
// re-running up() is a no-op even outside migrate.js's _migrations guard.
//
// down(): drops the four tables — a contraction, recorded here per the
// 274/278 convention; it is NOT part of this story's dev scope and any
// live use needs the separate Sumanth contract gate (design §6 step 5).
// =============================================================================

module.exports = {
	name: '279_assessment_catalogue',
	up: async (client) => {
		// ── assessment_subjects (§3.1) ────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_subjects (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(60) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        icon VARCHAR(10),
        description TEXT,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

		// ── assessment_topics (§3.2) ──────────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_topics (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES assessment_subjects(id),
        slug VARCHAR(80) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT,
        legacy_skill_name VARCHAR(100),
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (subject_id, slug)
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_topics_subject
        ON assessment_topics(subject_id)
    `);
		// §3.2 / SF-8: at most one topic may inherit a given legacy skill.
		await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_topics_legacy_skill_name
        ON assessment_topics (legacy_skill_name)
        WHERE legacy_skill_name IS NOT NULL
    `);

		// ── assessment_sets + assessment_set_questions (§3.3) ─────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_sets (
        id SERIAL PRIMARY KEY,
        topic_id INT NOT NULL REFERENCES assessment_topics(id),
        name VARCHAR(120) NOT NULL,
        format VARCHAR(20) NOT NULL CHECK (format IN ('mcq','short_answer','mixed','coding')),
        difficulty_band VARCHAR(10) NOT NULL CHECK (difficulty_band IN ('easy','medium','hard')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_sets_topic
        ON assessment_sets(topic_id)
    `);
		await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_set_questions (
        set_id INT NOT NULL REFERENCES assessment_sets(id) ON DELETE CASCADE,
        question_id INT NOT NULL REFERENCES assessment_questions(id),
        position INT NOT NULL,
        PRIMARY KEY (set_id, question_id)
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_set_questions_question
        ON assessment_set_questions(question_id)
    `);

		// ── Seed: 19 subjects (§3.1 / §6 step 2, idempotent per SF-7) ─────
		const subjects = await client.query(`
      INSERT INTO assessment_subjects (slug, name, category, icon, description, sort_order, is_active)
      VALUES
        ('javascript',       'JavaScript',       'technical',  'JS',  'Core JS, ES6+, async/await, closures, prototypes',                          1,  true),
        ('python',           'Python',           'technical',  'PY',  'Core Python, data structures, OOP, standard library',                       2,  true),
        ('react',            'React',            'technical',  'RE',  'Components, hooks, state management, lifecycle',                            3,  true),
        ('nodejs',           'Node.js',          'technical',  'NJ',  'Express, APIs, async patterns, middleware',                                 4,  true),
        ('sql',              'SQL',              'technical',  'SQL', 'Queries, joins, indexing, optimization, transactions',                      5,  true),
        ('typescript',       'TypeScript',       'technical',  'TS',  'Types, interfaces, generics, type guards',                                  6,  true),
        ('java',             'Java',             'technical',  'JV',  'OOP, collections, multithreading, design patterns',                         7,  true),
        ('html-css',         'HTML/CSS',         'technical',  'CSS', 'Flexbox, Grid, responsive design, accessibility',                           8,  true),
        ('aws',              'AWS',              'technical',  'AWS', 'EC2, S3, Lambda, IAM, CloudFormation',                                      9,  true),
        ('docker',           'Docker',           'technical',  'DK',  'Containers, images, compose, networking',                                   10, true),
        ('git',              'Git',              'technical',  'GIT', 'Branching, merging, rebasing, workflows',                                   11, true),
        ('data-analysis',    'Data Analysis',    'analytical', 'DA',  'Statistics, visualization, pandas, Excel formulas',                         12, true),
        ('system-design',    'System Design',    'technical',  'SD',  'Scalability, databases, caching, load balancing',                            13, true),
        ('project-management','Project Management','soft_skill', 'PM',  'Agile, planning, risk management, stakeholders',                             14, true),
        ('communication',    'Communication',    'soft_skill', 'CM',  'Written, verbal, presentation, feedback',                                   15, true),
        ('machine-learning', 'Machine Learning', 'technical',  'ML',  'Algorithms, neural networks, training, evaluation',                          16, true),
        ('dsa',              'DSA',              'technical',  'DSA', 'Data structures and algorithms: arrays, linked lists, trees, graphs, sorting, complexity analysis', 17, true),
        ('oop',              'OOP',              'technical',  'OOP', 'Object-oriented programming: classes, inheritance, polymorphism, encapsulation, design principles',  18, true),
        ('aptitude',         'Aptitude',         'analytical', 'APT', 'Quantitative, logical and verbal aptitude',                                 19, false)
      ON CONFLICT (slug) DO NOTHING
    `);
		console.log(
			`Migration 279: seeded ${subjects.rowCount} assessment_subjects (19 expected on a fresh install)`,
		);

		// ── Seed: one default topic per legacy skill (§3.2) ───────────────
		// legacy_skill_name is the EXACT legacy string (SKILL_CATALOG name /
		// assessment_questions.skill_category) the 280 backfill joins on.
		const legacyTopics = [
			['javascript', 'JavaScript'],
			['python', 'Python'],
			['react', 'React'],
			['nodejs', 'Node.js'],
			['sql', 'SQL'],
			['typescript', 'TypeScript'],
			['java', 'Java'],
			['html-css', 'CSS & HTML'],
			['aws', 'AWS'],
			['docker', 'Docker'],
			['git', 'Git'],
			['data-analysis', 'Data Analysis'],
			['system-design', 'System Design'],
			['project-management', 'Project Management'],
			['communication', 'Communication'],
			['machine-learning', 'Machine Learning'],
		];
		let topicsSeeded = 0;
		for (const [subjectSlug, legacyName] of legacyTopics) {
			const r = await client.query(
				`
        INSERT INTO assessment_topics (subject_id, slug, name, legacy_skill_name, sort_order, is_active)
        SELECT s.id, 'general', s.name || ' — General', $2, 0, true
        FROM assessment_subjects s
        WHERE s.slug = $1
        ON CONFLICT (subject_id, slug) DO NOTHING
      `,
				[subjectSlug, legacyName],
			);
			topicsSeeded += r.rowCount;
		}
		console.log(
			`Migration 279: seeded ${topicsSeeded} default assessment_topics (16 expected on a fresh install)`,
		);
	},
	down: async (client) => {
		await client.query(`DROP TABLE IF EXISTS assessment_set_questions`);
		await client.query(`DROP TABLE IF EXISTS assessment_sets`);
		await client.query(`DROP TABLE IF EXISTS assessment_topics`);
		await client.query(`DROP TABLE IF EXISTS assessment_subjects`);
	},
};
