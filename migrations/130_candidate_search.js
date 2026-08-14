/**
 * Migration 130: Candidate Search Index & Invites
 * Issue #3 — Candidate Search API
 *
 * Creates:
 * - candidate_search_index (denormalized search-optimized table with pgvector)
 * - candidate_invites (recruiter-to-candidate outreach)
 * - Sync function/trigger to keep index in sync with source tables
 * - Full-text search support via tsvector
 * - Performance indexes for sub-500ms queries
 */

module.exports = {
	name: '130_candidate_search',
	up: async (client) => {
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
          COALESCE(v_omi, 0), v_tier, COALESCE(v_avail, 'immediately'), v_title, v_bio,
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

		console.log('Migration 130 completed: candidate_search_index, candidate_invites, sync triggers');
	},
};
