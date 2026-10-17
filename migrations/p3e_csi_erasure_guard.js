/**
 * Migration p3e: candidate_search_index erasure guard (#1163)
 *
 * erasePersonalData DELETEs the candidate_search_index (CSI) row early
 * (lib/erasureService.js:649), but later steps in the SAME erasure
 * transaction re-fire the CSI sync triggers — candidate_skills DELETEs
 * (trg_sync_csi_skills) and `UPDATE users SET avatar_url = NULL`
 * (trg_sync_csi_users) — and sync_candidate_search_index() unconditionally
 * re-upserts the row. A tombstone-parity CSI row therefore exists again
 * after a completed erasure (verified on a scratch DB: name='Deleted
 * User', skills=[], omni_score=0, availability_status='immediately').
 *
 * Fix: guard INSIDE sync_candidate_search_index — the one shared
 * function every CSI trigger path (users / profiles / skills /
 * embeddings / omni) calls. If the users row is tombstoned
 * (deleted_at IS NOT NULL, migration 231), DELETE any CSI row for the
 * user and RETURN without upserting. This closes both production paths:
 * self-serve deletion tombstones the user BEFORE erasePersonalData
 * runs (routes/auth.js), and the admin DSAR path's last users-table
 * write is the GAP-G strip inside erasePersonalData, whose own trigger
 * call then removes any row resurrected by earlier steps.
 *
 * Ordering (the #1282 trap): migrate.js runs files in lexical filename
 * sort. sync_candidate_search_index is last re-defined by
 * p3b_candidate_search.js (262's copy is byte-identical), so a numbered
 * 267_* migration would be overwritten by p3b on fresh installs. This
 * file therefore sorts AFTER p3d_fix_users_trigger_user_id.js and
 * BEFORE p4_* — mirroring the 265/p3d forward-fix precedent: the FULL
 * current p3b function body, verbatim, plus the deleted_at guard at
 * the top. Idempotent (CREATE OR REPLACE): safe to run twice.
 *
 * p3b / 262 are applied migrations and are NOT edited.
 */

module.exports = {
	name: 'p3e_csi_erasure_guard',
	up: async (client) => {
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
        -- #1163: an erased (tombstoned) user must never be (re-)indexed.
        -- Erasure deletes the CSI row early (lib/erasureService.js:649),
        -- but later steps in the same transaction re-fire the sync
        -- triggers (candidate_skills DELETE, users avatar UPDATE). With
        -- deleted_at set, remove any resurrected row and do not upsert.
        IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND deleted_at IS NOT NULL) THEN
          DELETE FROM candidate_search_index WHERE user_id = p_user_id;
          RETURN;
        END IF;

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

		console.log('Migration p3e completed: sync_candidate_search_index skips tombstoned (deleted_at) users');
	},
};
