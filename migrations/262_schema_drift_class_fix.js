// =============================================================================
// Migration 262: schema-drift class fix (#1184)
// =============================================================================
//
// STOP 2 reviewed manifest is the build spec:
// docs/sdlc/rekrut-ai-v2/04-implementation/schema-drift-manifest-1184-REVIEWED.md
// (database reviewer gate, issue #1184 comment 6203647672; Lead synthesis
// 6203660899). This migration contains exactly the manifest's 262-ADD set:
//
//   1. Additive columns (ADD COLUMN IF NOT EXISTS only) at the manifest's
//      exact types/defaults/nullability — companies x9 (twin 002),
//      recruiter_join_requests x6 (twin 048), saved_jobs x2 (twin 004),
//      candidate_profiles preferences x5 (derived in the manifest),
//      jobs auto-send pair (twin p7), screening_sessions.current_phase
//      (twin p5), screening_templates.screening_mode (twin p6),
//      screening_sessions.updated_at, onboarding_documents.updated_at,
//      job_applications.hired_at, oauth_connections.token_expires_at
//      (twin 005b, latent shadow-register row).
//   2. Ruling 2, Option A: migrations/p3b_candidate_search.js's up() re-homed
//      IN FULL under this migration's OWN name (section 3 below is the
//      original up() body, byte-faithful — extension, both CREATE TABLEs,
//      all indexes, sync function, trigger functions, triggers, backfill —
//      under the originals' own IF NOT EXISTS / OR REPLACE /
//      DROP TRIGGER IF EXISTS guards). This migration records itself in
//      _migrations as '262_schema_drift_class_fix', NEVER as p3b's name
//      ('130_candidate_search'), so the post-p2 tail is not wrongly marked
//      as run; when p3b later executes under its own name it no-ops.
//
// Mechanics (STOP 1 section 5 + Ruling 3 section 6, binding):
//   - ADD COLUMN IF NOT EXISTS / CREATE IF NOT EXISTS only.
//   - NEVER ALTER COLUMN ... TYPE, never DROP, never recreate a table.
//   - After the adds, a verify step checks the added set's type families
//     against expectation and console.warn()s on mismatch — it NEVER
//     throws for a type mismatch (a throw would brick the whole migrate
//     run on uncharacterised live drift). Fresh-DB strictness is the CI
//     guard's job (scripts/check-schema-drift.js --ci); live = warn.
//   - Idempotent: running 262 twice, or on a DB where p3b already ran,
//     is a no-op.
// =============================================================================

const TYPE_FAMILY = (udt) => {
	if (['int2', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'serial', 'bigserial'].includes(udt)) return 'integer';
	if (udt === 'uuid') return 'uuid';
	if (['varchar', 'text', 'bpchar', 'name', 'character varying', 'character'].includes(udt)) return 'text';
	if (udt === 'bool' || udt === 'boolean') return 'boolean';
	if (['timestamptz', 'timestamp', 'timestamp without time zone', 'timestamp with time zone', 'date', 'time'].includes(udt)) return 'temporal';
	if (['jsonb', 'json'].includes(udt)) return 'json';
	if (['float4', 'float8', 'numeric'].includes(udt)) return 'numeric';
	if (udt === 'vector') return 'vector';
	if (udt === 'tsvector') return 'tsvector';
	return udt;
};

// Expected type families for every column this migration adds/creates.
// Used ONLY by the post-add verify step (warn, never throw).
const EXPECTED_FAMILIES = {
	companies: {
		logo_url: 'text', website: 'text', description: 'text', industry: 'text',
		company_size: 'text', founded_year: 'integer', headquarters: 'text',
		linkedin_url: 'text', verified_at: 'temporal',
	},
	recruiter_join_requests: {
		requested_at: 'temporal', approved_at: 'temporal', approved_by: 'integer',
		rejected_at: 'temporal', rejected_by: 'integer', rejection_reason: 'text',
	},
	saved_jobs: { saved_at: 'temporal', notes: 'text' },
	candidate_profiles: {
		work_mode: 'text', work_hours: 'text', start_date_flexibility: 'text',
		salary_expectation_min: 'integer', salary_expectation_max: 'integer',
	},
	jobs: { auto_send_on_apply: 'boolean', auto_send_min_score: 'integer' },
	screening_sessions: { current_phase: 'text', updated_at: 'temporal' },
	screening_templates: { screening_mode: 'text' },
	onboarding_documents: { updated_at: 'temporal' },
	job_applications: { hired_at: 'temporal' },
	oauth_connections: { token_expires_at: 'temporal' },
	candidate_search_index: {
		user_id: 'integer', embedding: 'vector', skills: 'json', location: 'text',
		experience_years: 'integer', omni_score: 'integer', score_tier: 'text',
		availability_status: 'text', job_title: 'text', bio: 'text', name: 'text',
		avatar_url: 'text', search_vector: 'tsvector', last_synced: 'temporal',
	},
	candidate_invites: {
		id: 'integer', candidate_id: 'integer', recruiter_id: 'integer',
		company_id: 'integer', job_id: 'integer', message: 'text', status: 'text',
		responded_at: 'temporal', created_at: 'temporal', updated_at: 'temporal',
	},
};

async function verifyAddedColumns(client) {
	try {
		const { rows } = await client.query(
			`SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public'`,
		);
		const actual = new Map();
		for (const r of rows) actual.set(`${r.table_name}.${r.column_name}`, r.udt_name);
		for (const [table, cols] of Object.entries(EXPECTED_FAMILIES)) {
			for (const [column, family] of Object.entries(cols)) {
				const udt = actual.get(`${table}.${column}`);
				if (!udt) {
					console.warn(`[migration 262] WARNING: expected column ${table}.${column} is missing after adds`);
				} else if (TYPE_FAMILY(udt) !== family) {
					console.warn(
						`[migration 262] WARNING: ${table}.${column} type family mismatch — expected ${family}, found ${udt} (left untouched; 262 never alters types)`,
					);
				}
			}
		}
	} catch (err) {
		// Verify must never brick the migrate run.
		console.warn(`[migration 262] WARNING: post-add verify step failed: ${err.message}`);
	}
}

module.exports = {
	name: '262_schema_drift_class_fix',
	async up(client) {
		// ─── 1. Additive columns (reviewed manifest, exact shapes) ─────
		// companies x9 — twin 002_add_trustscore.js
		await client.query(`
			ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS logo_url TEXT,
			ADD COLUMN IF NOT EXISTS website TEXT,
			ADD COLUMN IF NOT EXISTS description TEXT,
			ADD COLUMN IF NOT EXISTS industry VARCHAR(100),
			ADD COLUMN IF NOT EXISTS company_size VARCHAR(50),
			ADD COLUMN IF NOT EXISTS founded_year INTEGER,
			ADD COLUMN IF NOT EXISTS headquarters VARCHAR(255),
			ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
			ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP
		`);
		// recruiter_join_requests x6 — twin 048_company_domain_enforcement.js
		await client.query(`
			ALTER TABLE recruiter_join_requests
			ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT NOW(),
			ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
			ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
			ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			ADD COLUMN IF NOT EXISTS rejection_reason TEXT
		`);
		// saved_jobs x2 — twin 004_candidate_profiles.js
		await client.query(`
			ALTER TABLE saved_jobs
			ADD COLUMN IF NOT EXISTS saved_at TIMESTAMP DEFAULT NOW(),
			ADD COLUMN IF NOT EXISTS notes TEXT
		`);
		// candidate_profiles preferences x5 — derived in the reviewed manifest
		await client.query(`
			ALTER TABLE candidate_profiles
			ADD COLUMN IF NOT EXISTS work_mode VARCHAR(50),
			ADD COLUMN IF NOT EXISTS work_hours VARCHAR(50),
			ADD COLUMN IF NOT EXISTS start_date_flexibility VARCHAR(50),
			ADD COLUMN IF NOT EXISTS salary_expectation_min INTEGER,
			ADD COLUMN IF NOT EXISTS salary_expectation_max INTEGER
		`);
		// jobs auto-send pair — twin p7_auto_send_screening_on_jobs.js
		await client.query(`
			ALTER TABLE jobs
			ADD COLUMN IF NOT EXISTS auto_send_on_apply BOOLEAN DEFAULT false,
			ADD COLUMN IF NOT EXISTS auto_send_min_score INTEGER DEFAULT 70
		`);
		// screening_sessions — current_phase twin p5; updated_at derived in the manifest
		await client.query(`
			ALTER TABLE screening_sessions
			ADD COLUMN IF NOT EXISTS current_phase VARCHAR(50) DEFAULT 'intro',
			ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
		`);
		// screening_templates — screening_mode twin p6
		await client.query(`
			ALTER TABLE screening_templates
			ADD COLUMN IF NOT EXISTS screening_mode VARCHAR(50) DEFAULT 'conversational'
		`);
		// onboarding_documents.updated_at — derived in the reviewed manifest
		await client.query(`
			ALTER TABLE onboarding_documents
			ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
		`);
		// job_applications.hired_at — derived in the reviewed manifest
		// (populated by the companion code change in routes/candidate.js)
		await client.query(`
			ALTER TABLE job_applications
			ADD COLUMN IF NOT EXISTS hired_at TIMESTAMP
		`);
		// oauth_connections.token_expires_at — twin 005b_oauth_refresh_tokens.js (latent)
		await client.query(`
			ALTER TABLE oauth_connections
			ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP
		`);

		// ─── 2. p3b re-home (Ruling 2, Option A) ────────────────────────
		// migrations/p3b_candidate_search.js up() IN FULL, byte-faithful,
		// under the originals' own guards. Do not rebuild from manifest rows:
		// the DDL also carries search_vector / last_synced / responded_at.
		// ─── 1. Ensure pgvector extension ───────────────────────────────
		await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

		// ─── 2. Candidate Search Index (denormalized, search-optimized) ─
		await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_search_index (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        embedding VECTOR(1536),
        skills JSONB DEFAULT '[]',
        location VARCHAR(255),
        experience_years INTEGER DEFAULT 0,
        omni_score INTEGER DEFAULT 0,
        score_tier VARCHAR(20),
        availability_status VARCHAR(50) DEFAULT 'immediately',
        job_title VARCHAR(200),
        bio TEXT,
        name VARCHAR(255),
        avatar_url VARCHAR(500),
        search_vector TSVECTOR,
        last_synced TIMESTAMP DEFAULT NOW()
      )
    `);

		// ─── 3. Performance indexes ────────────────────────────────────
		// GIN index for skill array containment / overlap queries
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_skills ON candidate_search_index USING GIN (skills)
    `);

		// B-tree indexes for scalar filters
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_location ON candidate_search_index (location)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_experience ON candidate_search_index (experience_years)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_omni_score ON candidate_search_index (omni_score DESC)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_availability ON candidate_search_index (availability_status)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_score_tier ON candidate_search_index (score_tier)
    `);

		// Full-text search GIN index on search_vector
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_search_vector ON candidate_search_index USING GIN (search_vector)
    `);

		// pgvector ivfflat index for cosine-similarity semantic search
		// lists=100 is a good default for up to ~1M vectors
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_embedding ON candidate_search_index
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
    `);

		// Composite index for common filter combos
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_csi_filters ON candidate_search_index
      (availability_status, experience_years, omni_score DESC)
    `);

		// ─── 4. Candidate Invites table ────────────────────────────────
		await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_invites (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        message TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        responded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(candidate_id, recruiter_id, job_id)
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invites_candidate ON candidate_invites(candidate_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invites_recruiter ON candidate_invites(recruiter_id)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invites_status ON candidate_invites(status)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invites_created_at ON candidate_invites(created_at DESC)
    `);

		// ─── 5. Sync function: source tables → candidate_search_index ─
		await client.query(`
      CREATE OR REPLACE FUNCTION sync_candidate_search_index(p_user_id INTEGER)
      RETURNS VOID AS $$
      DECLARE
        v_skills JSONB;
        v_location VARCHAR(255);
        v_experience INTEGER;
        v_omni INTEGER;
        v_tier VARCHAR(20);
        v_avail VARCHAR(50);
        v_title VARCHAR(200);
        v_bio TEXT;
        v_name VARCHAR(255);
        v_avatar VARCHAR(500);
        v_embedding VECTOR(1536);
        v_search_text TEXT;
      BEGIN
        -- Aggregate skills
        SELECT COALESCE(jsonb_agg(cs.skill_name ORDER BY cs.level DESC), '[]'::jsonb)
        INTO v_skills
        FROM candidate_skills cs
        WHERE cs.user_id = p_user_id;

        -- Profile fields
        SELECT cp.location, cp.years_experience, cp.availability, cp.headline, cp.bio, u.name, u.avatar_url
        INTO v_location, v_experience, v_avail, v_title, v_bio, v_name, v_avatar
        FROM users u
        LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
        WHERE u.id = p_user_id;

        -- OmniScore
        SELECT os.total_score, os.score_tier
        INTO v_omni, v_tier
        FROM omni_scores os
        WHERE os.user_id = p_user_id;

        -- Embedding
        SELECT ce.embedding
        INTO v_embedding
        FROM candidate_embeddings ce
        WHERE ce.user_id = p_user_id;

        -- Build search text for tsvector
        v_search_text := COALESCE(v_title, '') || ' ' ||
                         COALESCE(v_bio, '') || ' ' ||
                         COALESCE(array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_skills)), ' '), '');

        -- Upsert into candidate_search_index
        INSERT INTO candidate_search_index (
          user_id, embedding, skills, location, experience_years,
          omni_score, score_tier, availability_status, job_title, bio,
          name, avatar_url, search_vector, last_synced
        ) VALUES (
          p_user_id, v_embedding, v_skills, v_location, COALESCE(v_experience, 0),
          COALESCE(v_omni, 0), v_tier, COALESCE(v_avail, 'immediately'), v_title, v_bio,
          v_name, v_avatar, to_tsvector('english', v_search_text), NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          embedding = EXCLUDED.embedding,
          skills = EXCLUDED.skills,
          location = EXCLUDED.location,
          experience_years = EXCLUDED.experience_years,
          omni_score = EXCLUDED.omni_score,
          score_tier = EXCLUDED.score_tier,
          availability_status = EXCLUDED.availability_status,
          job_title = EXCLUDED.job_title,
          bio = EXCLUDED.bio,
          name = EXCLUDED.name,
          avatar_url = EXCLUDED.avatar_url,
          search_vector = EXCLUDED.search_vector,
          last_synced = NOW();
      END;
      $$ LANGUAGE plpgsql;
    `);

		// ─── 6. Trigger to auto-sync on profile changes ────────────────
		await client.query(`
      CREATE OR REPLACE FUNCTION trigger_sync_candidate_search_index()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM sync_candidate_search_index(NEW.user_id);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

		// Skills-specific trigger function (needs to handle DELETE where OLD.user_id is available)
		await client.query(`
      CREATE OR REPLACE FUNCTION trigger_sync_candidate_search_index_skills()
      RETURNS TRIGGER AS $$
      DECLARE
        v_user_id INTEGER;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_user_id := OLD.user_id;
        ELSE
          v_user_id := NEW.user_id;
        END IF;
        PERFORM sync_candidate_search_index(v_user_id);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

		// Trigger on candidate_profiles
		await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_csi_profiles ON candidate_profiles;
      CREATE TRIGGER trg_sync_csi_profiles
        AFTER INSERT OR UPDATE ON candidate_profiles
        FOR EACH ROW
        EXECUTE FUNCTION trigger_sync_candidate_search_index();
    `);

		// Trigger on candidate_skills
		await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_csi_skills ON candidate_skills;
      CREATE TRIGGER trg_sync_csi_skills
        AFTER INSERT OR UPDATE OR DELETE ON candidate_skills
        FOR EACH ROW
        EXECUTE FUNCTION trigger_sync_candidate_search_index_skills();
    `);

		// Trigger on candidate_embeddings (when embedding is updated)
		await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_csi_embeddings ON candidate_embeddings;
      CREATE TRIGGER trg_sync_csi_embeddings
        AFTER INSERT OR UPDATE ON candidate_embeddings
        FOR EACH ROW
        EXECUTE FUNCTION trigger_sync_candidate_search_index();
    `);

		// Trigger on omni_scores
		await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_csi_omni ON omni_scores;
      CREATE TRIGGER trg_sync_csi_omni
        AFTER INSERT OR UPDATE ON omni_scores
        FOR EACH ROW
        EXECUTE FUNCTION trigger_sync_candidate_search_index();
    `);

		// Trigger on users (name, avatar_url changes)
		await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_csi_users ON users;
      CREATE TRIGGER trg_sync_csi_users
        AFTER UPDATE OF name, avatar_url ON users
        FOR EACH ROW
        WHEN (NEW.role = 'candidate')
        EXECUTE FUNCTION trigger_sync_candidate_search_index();
    `);

		// ─── 7. Backfill existing candidates ───────────────────────────
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN SELECT id FROM users WHERE role = 'candidate' LOOP
          PERFORM sync_candidate_search_index(r.id);
        END LOOP;
      END $$;
    `);

		// ─── 3. Post-add verify (warn only, never throw) ───────────────
		await verifyAddedColumns(client);

		console.log('Migration 262: schema-drift class fix applied (#1184)');
	},

	async down(client) {
		// Reverse of the additive columns only. The p3b re-home is NOT
		// dropped here: those tables may pre-date 262 (p3b's own down does
		// not exist either), and dropping them could delete live data.
		await client.query(`
			ALTER TABLE companies
			DROP COLUMN IF EXISTS verified_at,
			DROP COLUMN IF EXISTS linkedin_url,
			DROP COLUMN IF EXISTS headquarters,
			DROP COLUMN IF EXISTS founded_year,
			DROP COLUMN IF EXISTS company_size,
			DROP COLUMN IF EXISTS industry,
			DROP COLUMN IF EXISTS description,
			DROP COLUMN IF EXISTS website,
			DROP COLUMN IF EXISTS logo_url
		`);
		await client.query(`
			ALTER TABLE recruiter_join_requests
			DROP COLUMN IF EXISTS rejection_reason,
			DROP COLUMN IF EXISTS rejected_by,
			DROP COLUMN IF EXISTS rejected_at,
			DROP COLUMN IF EXISTS approved_by,
			DROP COLUMN IF EXISTS approved_at,
			DROP COLUMN IF EXISTS requested_at
		`);
		await client.query(`
			ALTER TABLE saved_jobs
			DROP COLUMN IF EXISTS notes,
			DROP COLUMN IF EXISTS saved_at
		`);
		await client.query(`
			ALTER TABLE candidate_profiles
			DROP COLUMN IF EXISTS salary_expectation_max,
			DROP COLUMN IF EXISTS salary_expectation_min,
			DROP COLUMN IF EXISTS start_date_flexibility,
			DROP COLUMN IF EXISTS work_hours,
			DROP COLUMN IF EXISTS work_mode
		`);
		await client.query(`
			ALTER TABLE jobs
			DROP COLUMN IF EXISTS auto_send_min_score,
			DROP COLUMN IF EXISTS auto_send_on_apply
		`);
		await client.query(`
			ALTER TABLE screening_sessions
			DROP COLUMN IF EXISTS updated_at,
			DROP COLUMN IF EXISTS current_phase
		`);
		await client.query(`
			ALTER TABLE screening_templates
			DROP COLUMN IF EXISTS screening_mode
		`);
		await client.query(`
			ALTER TABLE onboarding_documents
			DROP COLUMN IF EXISTS updated_at
		`);
		await client.query(`
			ALTER TABLE job_applications
			DROP COLUMN IF EXISTS hired_at
		`);
		await client.query(`
			ALTER TABLE oauth_connections
			DROP COLUMN IF EXISTS token_expires_at
		`);
	},
};
