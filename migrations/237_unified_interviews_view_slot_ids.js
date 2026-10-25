/**
 * Migration 237: unified_interviews view — include proposed_slots slot ids.
 *
 * Follow-up to 236. The candidate slot-picker UI needs each proposed slot's
 * `id` to call POST /api/interviews/unified/:id/confirm-slot { slot_id }.
 * 236's jsonb_build_object only carried {start, end, status}.
 *
 * NON-DESTRUCTIVE: CREATE OR REPLACE VIEW only; no tables dropped, no data
 * changed. Fully reversible: re-run 236's view definition (or DROP VIEW).
 */
module.exports = {
	name: '237_unified_interviews_view_slot_ids',
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
              'id', p.id,
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
		console.log('[migration:237] unified_interviews view recreated with slot ids');
	},
};
