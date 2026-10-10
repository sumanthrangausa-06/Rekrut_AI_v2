/**
 * Migration 236: unified_interviews view — read-only union over the two
 * human-interview systems.
 *
 * System A: scheduled_interviews (single fixed date/time, live UI).
 * System B: interview_events + proposed_slots (multi-slot negotiation).
 *
 * NON-DESTRUCTIVE: no tables dropped, no data changed. The view gives the
 * unified interview service a single read surface; writes continue to go to
 * the originating tables. Fully reversible: DROP VIEW unified_interviews.
 *
 * Notes:
 * - scheduled_at is normalized to TIMESTAMPTZ (System A stores TIMESTAMP).
 * - System B has no direct company_id/job_id; they are resolved via
 *   job_applications (LEFT JOIN — job_application_id is nullable).
 * - proposed_slots is NULL for System A rows (no slot negotiation there).
 */
module.exports = {
	name: '236_unified_interviews_view',
	up: async (client) => {
		await client.query(`
      CREATE OR REPLACE VIEW unified_interviews AS
      SELECT
        s.id,
        s.candidate_id,
        s.recruiter_id,
        s.company_id,
        s.job_id,
        s.scheduled_at::timestamptz AS scheduled_at,
        s.duration_minutes,
        s.status,
        s.meeting_link,
        s.interview_type,
        s.notes,
        'system_a'::text AS source_system,
        NULL::jsonb AS proposed_slots
      FROM scheduled_interviews s
      UNION ALL
      SELECT
        e.id,
        e.candidate_id,
        e.recruiter_id,
        ja.company_id,
        ja.job_id,
        e.scheduled_at,
        e.duration_minutes,
        e.status,
        COALESCE(e.meeting_link, e.livekit_room_url) AS meeting_link,
        'video'::varchar(50) AS interview_type,
        e.notes,
        'system_b'::text AS source_system,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'start', p.slot_start,
              'end', p.slot_end,
              'status', p.status
            )
            ORDER BY p.slot_start
          )
          FROM proposed_slots p
          WHERE p.interview_event_id = e.id
        ) AS proposed_slots
      FROM interview_events e
      LEFT JOIN job_applications ja ON ja.id = e.job_application_id
    `);
		console.log('[migration:236] unified_interviews view created');
	},
};
