/**
 * InterviewService — unified logic layer over the two human-interview systems.
 *
 * System A: scheduled_interviews (single fixed date/time, live UI).
 * System B: interview_events + proposed_slots (multi-slot negotiation).
 *
 * Read contract: every interview, regardless of origin system, is returned in
 * one normalized shape (see normalizeInterview). Reads prefer the
 * `unified_interviews` view (migration 236); if the view does not exist yet
 * (e.g. this service merges before the migration runs), it falls back to
 * querying both tables directly and normalizing in JS.
 *
 * Write contract: new interviews go to System B (the better model —
 * multi-slot negotiation). System A is read-only through this service;
 * existing System A endpoints/tables are untouched.
 *
 * Errors: thrown as Error with a `code` property so routes can map them to
 * HTTP statuses:
 *   'NOT_FOUND'     -> 404
 *   'FORBIDDEN'     -> 403
 *   'INVALID_STATE' -> 400
 *   'VALIDATION'    -> 400
 *
 * No deletions, no migrations in this service. Fully reversible: routes can
 * stop calling it at any time.
 */
const pool = require('../lib/db');

const SOURCE_A = 'system_a';
const SOURCE_B = 'system_b';

const MAX_SLOTS = 10;

function serviceError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

/**
 * Normalize one interview (from the view or a direct table row) into the
 * unified shape consumed by the UI.
 */
function normalizeInterview(row) {
	return {
		id: row.id,
		candidate_id: row.candidate_id,
		recruiter_id: row.recruiter_id,
		company_id: row.company_id ?? null,
		job_id: row.job_id ?? null,
		scheduled_at: row.scheduled_at ?? null,
		duration_minutes: row.duration_minutes ?? 60,
		status: row.status,
		meeting_link: row.meeting_link ?? null,
		interview_type: row.interview_type ?? 'video',
		notes: row.notes ?? null,
		source_system: row.source_system,
		// System B: array of {start, end, status} (view) or slot rows; System A: null
		proposed_slots: row.proposed_slots ?? null,
	};
}

/**
 * Direct-table fallback for getMyInterviews when the unified_interviews view
 * does not exist yet (migration 236 not applied). Mirrors the view's SELECTs.
 */
async function getMyInterviewsFallback(userId, role) {
	const col = role === 'recruiter' ? 'recruiter_id' : 'candidate_id';

	const aRes = await pool.query(
		`SELECT id, candidate_id, recruiter_id, company_id, job_id,
		        scheduled_at::timestamptz AS scheduled_at,
		        duration_minutes, status, meeting_link, interview_type, notes,
		        'system_a'::text AS source_system,
		        NULL::jsonb AS proposed_slots
		   FROM scheduled_interviews
		  WHERE ${col} = $1`,
		[userId],
	);

	const bRes = await pool.query(
		`SELECT e.id, e.candidate_id, e.recruiter_id,
		        ja.company_id, ja.job_id,
		        e.scheduled_at, e.duration_minutes, e.status,
		        COALESCE(e.meeting_link, e.livekit_room_url) AS meeting_link,
		        'video'::varchar(50) AS interview_type,
		        e.notes, 'system_b'::text AS source_system,
		        (SELECT jsonb_agg(
		           jsonb_build_object('start', p.slot_start, 'end', p.slot_end, 'status', p.status)
		           ORDER BY p.slot_start)
		           FROM proposed_slots p WHERE p.interview_event_id = e.id) AS proposed_slots
		   FROM interview_events e
		   LEFT JOIN job_applications ja ON ja.id = e.job_application_id
		  WHERE e.${col} = $1`,
		[userId],
	);

	return [...aRes.rows, ...bRes.rows]
		.map(normalizeInterview)
		.sort((x, y) => {
			if (!x.scheduled_at && !y.scheduled_at) return y.id - x.id;
			if (!x.scheduled_at) return 1;
			if (!y.scheduled_at) return -1;
			return new Date(y.scheduled_at) - new Date(x.scheduled_at);
		});
}

/**
 * Get all human interviews for a user, across both systems, in one shape.
 * role: 'candidate' (filter candidate_id) or 'recruiter' (filter recruiter_id).
 */
async function getMyInterviews(userId, role) {
	if (!Number.isInteger(userId)) {
		throw serviceError('VALIDATION', 'userId must be an integer');
	}
	const col = role === 'recruiter' ? 'recruiter_id' : 'candidate_id';

	try {
		const res = await pool.query(
			`SELECT id, candidate_id, recruiter_id, company_id, job_id, scheduled_at,
			        duration_minutes, status, meeting_link, interview_type, notes,
			        source_system, proposed_slots
			   FROM unified_interviews
			  WHERE ${col} = $1
			  ORDER BY scheduled_at DESC NULLS LAST, id DESC`,
			[userId],
		);
		return res.rows.map(normalizeInterview);
	} catch (err) {
		// 42P01 = undefined_table: migration 236 hasn't run yet — fall back.
		if (err && err.code === '42P01') {
			return getMyInterviewsFallback(userId, role);
		}
		throw err;
	}
}

function validateSlots(proposed_slots) {
	if (!Array.isArray(proposed_slots) || proposed_slots.length === 0) {
		throw serviceError('VALIDATION', 'proposed_slots must be a non-empty array');
	}
	if (proposed_slots.length > MAX_SLOTS) {
		throw serviceError('VALIDATION', `proposed_slots must have at most ${MAX_SLOTS} entries`);
	}
	for (const s of proposed_slots) {
		const start = new Date(s.start ?? s.slot_start);
		const end = new Date(s.end ?? s.slot_end);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			throw serviceError('VALIDATION', 'each slot needs a valid start and end');
		}
		if (start >= end) {
			throw serviceError('VALIDATION', 'slot start must be before slot end');
		}
	}
}

/**
 * Create a new interview (System B): one interview_events row with
 * status='proposed' plus one proposed_slots row per slot (status='offered').
 */
async function createInterview(data = {}) {
	const {
		job_application_id = null,
		recruiter_id,
		candidate_id,
		proposed_slots,
		duration_minutes = 60,
		timezone = 'UTC',
		notes = null,
		panel_member_ids = [],
	} = data;

	if (!Number.isInteger(recruiter_id) || !Number.isInteger(candidate_id)) {
		throw serviceError('VALIDATION', 'recruiter_id and candidate_id are required integers');
	}
	if (recruiter_id === candidate_id) {
		throw serviceError('VALIDATION', 'recruiter_id and candidate_id must differ');
	}
	validateSlots(proposed_slots);

	await pool.query('BEGIN');
	try {
		const eventRes = await pool.query(
			`INSERT INTO interview_events
			   (job_application_id, recruiter_id, candidate_id, panel_member_ids,
			    duration_minutes, timezone, status, notes, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, 'proposed', $7, NOW(), NOW())
			 RETURNING *`,
			[
				job_application_id,
				recruiter_id,
				candidate_id,
				panel_member_ids,
				duration_minutes,
				timezone,
				notes,
			],
		);
		const event = eventRes.rows[0];

		const slots = [];
		for (const s of proposed_slots) {
			const slotRes = await pool.query(
				`INSERT INTO proposed_slots
				   (interview_event_id, proposed_by, slot_start, slot_end, timezone, status)
				 VALUES ($1, $2, $3, $4, $5, 'offered')
				 RETURNING *`,
				[
					event.id,
					recruiter_id,
					new Date(s.start ?? s.slot_start),
					new Date(s.end ?? s.slot_end),
					timezone,
				],
			);
			slots.push(slotRes.rows[0]);
		}

		await pool.query('COMMIT');
		return { event, slots };
	} catch (err) {
		await pool.query('ROLLBACK');
		throw err;
	}
}

/**
 * Fetch one interview from its originating table, normalized.
 * source_system: 'system_a' | 'system_b'
 */
async function getInterview(id, source_system) {
	const interviewId = parseInt(id, 10);
	if (!Number.isInteger(interviewId)) {
		throw serviceError('VALIDATION', 'id must be an integer');
	}

	if (source_system === SOURCE_B) {
		const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [
			interviewId,
		]);
		if (eventRes.rows.length === 0) {
			throw serviceError('NOT_FOUND', 'Interview not found');
		}
		const slotRes = await pool.query(
			'SELECT * FROM proposed_slots WHERE interview_event_id = $1 ORDER BY slot_start',
			[interviewId],
		);
		const event = eventRes.rows[0];
		return {
			...normalizeInterview({ ...event, source_system: SOURCE_B }),
			proposed_slots: slotRes.rows,
		};
	}

	// Default: System A
	const res = await pool.query('SELECT * FROM scheduled_interviews WHERE id = $1', [
		interviewId,
	]);
	if (res.rows.length === 0) {
		throw serviceError('NOT_FOUND', 'Interview not found');
	}
	return normalizeInterview({ ...res.rows[0], source_system: SOURCE_A });
}

/**
 * Candidate confirms one proposed slot (System B only):
 * slot -> 'accepted', other slots -> 'expired', event.scheduled_at set,
 * event.status -> 'confirmed'. Transactional.
 */
async function confirmSlot(event_id, slot_id, userId) {
	const eventId = parseInt(event_id, 10);
	const slotId = parseInt(slot_id, 10);
	if (!Number.isInteger(eventId) || !Number.isInteger(slotId)) {
		throw serviceError('VALIDATION', 'event_id and slot_id must be integers');
	}

	const eventRes = await pool.query('SELECT * FROM interview_events WHERE id = $1', [eventId]);
	if (eventRes.rows.length === 0) {
		throw serviceError('NOT_FOUND', 'Interview event not found');
	}
	const event = eventRes.rows[0];

	if (event.candidate_id !== userId) {
		throw serviceError('FORBIDDEN', 'Only the candidate can book this interview');
	}
	if (event.status !== 'proposed') {
		throw serviceError('INVALID_STATE', `Interview is already ${event.status}`);
	}

	const slotRes = await pool.query(
		`SELECT * FROM proposed_slots
		  WHERE id = $1 AND interview_event_id = $2 AND status = 'offered'`,
		[slotId, eventId],
	);
	if (slotRes.rows.length === 0) {
		throw serviceError('INVALID_STATE', 'Slot not found or no longer available');
	}
	const slot = slotRes.rows[0];

	await pool.query('BEGIN');
	try {
		await pool.query(
			`UPDATE proposed_slots SET status = 'accepted', candidate_response_at = NOW() WHERE id = $1`,
			[slotId],
		);
		await pool.query(
			`UPDATE proposed_slots SET status = 'expired' WHERE interview_event_id = $1 AND id != $2`,
			[eventId, slotId],
		);
		await pool.query(
			`UPDATE interview_events
			    SET scheduled_at = $1, status = 'confirmed', updated_at = NOW()
			  WHERE id = $2`,
			[slot.slot_start, eventId],
		);
		await pool.query('COMMIT');
	} catch (err) {
		await pool.query('ROLLBACK');
		throw err;
	}

	return getInterview(eventId, SOURCE_B);
}

module.exports = {
	getMyInterviews,
	createInterview,
	getInterview,
	confirmSlot,
	normalizeInterview,
	SOURCE_A,
	SOURCE_B,
};
