/**
 * Task 6 (#323) — session egress recording: start / stop / retention.
 *
 * Unit tests against the REAL service functions (startSessionEgress,
 * stopSessionEgress, getRecordingRetentionDate). The LiveKit SDK boundary
 * (EgressClient) and the DB (lib/db, via server/test/setup.js) are mocked.
 * No network in jest.
 *
 * RED/GREEN: every test below fails before the Task 6 implementation
 * (startSessionEgress / stopSessionEgress do not exist on the service).
 */

const mockEgressClient = {
	startRoomCompositeEgress: jest.fn(),
	stopEgress: jest.fn(),
	listEgress: jest.fn(),
};
jest.mock('livekit-server-sdk', () => {
	const actual = jest.requireActual('livekit-server-sdk');
	return { ...actual, EgressClient: jest.fn(() => mockEgressClient) };
});

// Hermetic config (values never leave the process).
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
process.env.RECORDING_STORAGE_BUCKET = 'test-bucket';
process.env.RECORDING_STORAGE_REGION = 'auto';
process.env.RECORDING_STORAGE_ENDPOINT = 'https://test.r2.local';
process.env.RECORDING_STORAGE_ACCESS_KEY = 'test-access';
process.env.RECORDING_STORAGE_SECRET_KEY = 'test-secret-key';

const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();
const livekitService = require('../../services/livekit');

// ─── In-memory stores ─────────────────────────────────────────────────────────
const recordings = new Map(); // id -> row
const rooms = new Map(); // id -> row
const consents = new Map(); // `${recordingId}:${userId}` -> { consent_type }
let nextRecordingId = 1;

function seed() {
	recordings.clear();
	rooms.clear();
	consents.clear();
	nextRecordingId = 1;
	mockEgressClient.startRoomCompositeEgress.mockReset();
	mockEgressClient.stopEgress.mockReset();
	mockEgressClient.listEgress.mockReset();
	mockEgressClient.listEgress.mockResolvedValue([]);
	mockEgressClient.stopEgress.mockImplementation(async (egressId) => ({
		egressId,
		status: 'EGRESS_COMPLETE',
	}));
	// Active room for session 10.
	rooms.set(1, {
		id: 1,
		interview_event_id: null,
		interview_session_id: 10,
		room_name: 'interview-10',
		livekit_room_id: 'RM_10',
		status: 'active',
	});
}

function seedRecording(overrides = {}) {
	const row = {
		id: nextRecordingId++,
		interview_event_id: null,
		room_id: null,
		interview_session_id: 10,
		livekit_egress_id: null,
		status: 'pending',
		started_at: null,
		stopped_at: null,
		retention_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	};
	recordings.set(row.id, row);
	return row;
}

function handleSql(normalized, params) {
	if (
		normalized.includes('from interview_recordings') &&
		normalized.includes('interview_session_id')
	) {
		const rows = [...recordings.values()].filter(
			(r) => Number(r.interview_session_id) === Number(params[0]),
		);
		rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
		return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
	}
	if (normalized.startsWith('insert into interview_recordings')) {
		const row = {
			id: nextRecordingId++,
			interview_event_id: params[0],
			room_id: params[1],
			interview_session_id: params[2],
			livekit_egress_id: params[3],
			status: params[4],
			started_at: new Date().toISOString(),
			stopped_at: null,
			retention_expires_at: params[5] instanceof Date ? params[5].toISOString() : params[5],
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		recordings.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.startsWith('update interview_recordings set livekit_egress_id')) {
		const row = recordings.get(Number(params[1]));
		if (row) {
			row.livekit_egress_id = params[0];
			row.status = 'recording';
			if (!row.started_at) row.started_at = new Date().toISOString();
			row.updated_at = new Date().toISOString();
		}
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_rooms') && normalized.includes('interview_session_id')) {
		const found = [...rooms.values()].find(
			(r) => Number(r.interview_session_id) === Number(params[0]) && r.status === 'active',
		);
		return { rows: found ? [{ ...found }] : [], rowCount: found ? 1 : 0 };
	}
	if (normalized.startsWith('select consent_type from recording_consent')) {
		const row = consents.get(`${params[0]}:${params[1]}`);
		return { rows: row ? [{ consent_type: row.consent_type }] : [], rowCount: row ? 1 : 0 };
	}
	return null;
}

db.query.mockImplementation(async (sql, params) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	const handled = handleSql(normalized, params || []);
	if (handled) return handled;
	return baseQueryImpl(sql, params);
});

beforeEach(seed);

describe('getRecordingRetentionDate (Phase 1 retention policy)', () => {
	const OLD_ENV = process.env.RECORDING_RETENTION_DAYS;
	afterEach(() => {
		if (OLD_ENV === undefined) delete process.env.RECORDING_RETENTION_DAYS;
		else process.env.RECORDING_RETENTION_DAYS = OLD_ENV;
	});

	test('defaults to ~90 days from now', () => {
		delete process.env.RECORDING_RETENTION_DAYS;
		const d = livekitService.getRecordingRetentionDate();
		const deltaDays = (d.getTime() - Date.now()) / (24 * 3600 * 1000);
		expect(deltaDays).toBeGreaterThan(89.9);
		expect(deltaDays).toBeLessThan(90.1);
	});

	test('respects RECORDING_RETENTION_DAYS override', () => {
		process.env.RECORDING_RETENTION_DAYS = '30';
		const d = livekitService.getRecordingRetentionDate();
		const deltaDays = (d.getTime() - Date.now()) / (24 * 3600 * 1000);
		expect(deltaDays).toBeGreaterThan(29.9);
		expect(deltaDays).toBeLessThan(30.1);
	});
});

describe('startSessionEgress', () => {
	test('refuses without active candidate consent (403 CONSENT_REQUIRED) and starts nothing', async () => {
		const rec = seedRecording({ interview_session_id: 10 });
		// No consent row at all -> hasActiveConsent false.

		await expect(livekitService.startSessionEgress(10, { consentUserId: 1 })).rejects.toMatchObject(
			{
				status: 403,
				code: 'CONSENT_REQUIRED',
			},
		);
		expect(mockEgressClient.startRoomCompositeEgress).not.toHaveBeenCalled();
		expect(recordings.get(rec.id).livekit_egress_id).toBeNull();
	});

	test('refuses when consent was withdrawn', async () => {
		const rec = seedRecording({ interview_session_id: 10 });
		consents.set(`${rec.id}:1`, { consent_type: 'withdrawn' });

		await expect(livekitService.startSessionEgress(10, { consentUserId: 1 })).rejects.toMatchObject(
			{ status: 403, code: 'CONSENT_REQUIRED' },
		);
		expect(mockEgressClient.startRoomCompositeEgress).not.toHaveBeenCalled();
	});

	test('starts room-composite egress and links it to the session recording', async () => {
		const rec = seedRecording({ interview_session_id: 10 });
		consents.set(`${rec.id}:1`, { consent_type: 'explicit' });
		mockEgressClient.startRoomCompositeEgress.mockResolvedValue({
			egressId: 'EG_1',
			status: 'EGRESS_ACTIVE',
		});

		const result = await livekitService.startSessionEgress(10, { consentUserId: 1 });

		expect(mockEgressClient.startRoomCompositeEgress).toHaveBeenCalledTimes(1);
		expect(mockEgressClient.startRoomCompositeEgress).toHaveBeenCalledWith(
			'interview-10',
			expect.anything(),
		);
		expect(result.egressId).toBe('EG_1');
		const row = recordings.get(rec.id);
		expect(row.livekit_egress_id).toBe('EG_1');
		expect(row.status).toBe('recording');
		expect(row.retention_expires_at).toBeTruthy();
	});

	test('creates the recording row when none exists (retention set per policy)', async () => {
		// Consent must exist for the row created mid-call: pre-seed consent for the
		// id the INSERT will assign (nextRecordingId === 1 after seed).
		consents.set(`1:1`, { consent_type: 'explicit' });
		mockEgressClient.startRoomCompositeEgress.mockResolvedValue({
			egressId: 'EG_new',
			status: 'EGRESS_ACTIVE',
		});

		const result = await livekitService.startSessionEgress(10, { consentUserId: 1 });

		expect(result.egressId).toBe('EG_new');
		const rows = [...recordings.values()].filter((r) => Number(r.interview_session_id) === 10);
		expect(rows).toHaveLength(1);
		expect(rows[0].livekit_egress_id).toBe('EG_new');
		expect(rows[0].retention_expires_at).toBeTruthy();
	});

	test('is idempotent when egress is already active', async () => {
		const rec = seedRecording({ interview_session_id: 10, livekit_egress_id: 'EG_old' });
		consents.set(`${rec.id}:1`, { consent_type: 'explicit' });
		mockEgressClient.listEgress.mockResolvedValue([
			{ egressId: 'EG_old', status: 'EGRESS_ACTIVE' },
		]);

		const result = await livekitService.startSessionEgress(10, { consentUserId: 1 });

		expect(result).toMatchObject({ already_started: true, egressId: 'EG_old' });
		expect(mockEgressClient.startRoomCompositeEgress).not.toHaveBeenCalled();
	});

	test('starts a fresh egress when the recorded one is terminal', async () => {
		const rec = seedRecording({ interview_session_id: 10, livekit_egress_id: 'EG_dead' });
		consents.set(`${rec.id}:1`, { consent_type: 'explicit' });
		mockEgressClient.listEgress.mockResolvedValue([
			{ egressId: 'EG_dead', status: 'EGRESS_COMPLETE' },
		]);
		mockEgressClient.startRoomCompositeEgress.mockResolvedValue({
			egressId: 'EG_fresh',
			status: 'EGRESS_ACTIVE',
		});

		const result = await livekitService.startSessionEgress(10, { consentUserId: 1 });

		expect(result.egressId).toBe('EG_fresh');
		expect(recordings.get(rec.id).livekit_egress_id).toBe('EG_fresh');
	});
});

describe('stopSessionEgress', () => {
	test('stops the active egress and returns its id + status', async () => {
		seedRecording({ interview_session_id: 10, livekit_egress_id: 'EG_1', status: 'recording' });

		const result = await livekitService.stopSessionEgress(10);

		expect(mockEgressClient.stopEgress).toHaveBeenCalledTimes(1);
		expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('EG_1');
		expect(result).toMatchObject({ egressId: 'EG_1', status: 'EGRESS_COMPLETE' });
	});

	// I2 (#323): the stopEgress response is the only source of the final R2
	// file location and duration — surface them so the complete endpoint can
	// backfill the recording row.
	test('surfaces fileLocation + durationSeconds from the stopEgress fileResults', async () => {
		seedRecording({ interview_session_id: 10, livekit_egress_id: 'EG_1', status: 'recording' });
		mockEgressClient.stopEgress.mockResolvedValueOnce({
			egressId: 'EG_1',
			status: 'EGRESS_COMPLETE',
			fileResults: [
				{
					filename: 'interview-10-123.mp4',
					location: 's3://test-bucket/rekrut-recordings/interview-10-123.mp4',
					size: 1048576n,
					duration: 120_000_000_000n, // int64 nanoseconds
				},
			],
		});

		const result = await livekitService.stopSessionEgress(10);

		expect(result).toMatchObject({
			egressId: 'EG_1',
			status: 'EGRESS_COMPLETE',
			fileLocation: 's3://test-bucket/rekrut-recordings/interview-10-123.mp4',
			durationSeconds: 120,
			fileSizeBytes: 1048576,
		});
	});

	test('returns null and stops nothing when there is no egress id', async () => {
		seedRecording({ interview_session_id: 10, livekit_egress_id: null });

		const result = await livekitService.stopSessionEgress(10);

		expect(result).toBeNull();
		expect(mockEgressClient.stopEgress).not.toHaveBeenCalled();
	});

	test('returns null when the session has no recording row', async () => {
		const result = await livekitService.stopSessionEgress(999);

		expect(result).toBeNull();
		expect(mockEgressClient.stopEgress).not.toHaveBeenCalled();
	});

	test('never throws: a failed stop is reported, not raised', async () => {
		seedRecording({ interview_session_id: 10, livekit_egress_id: 'EG_boom' });
		mockEgressClient.stopEgress.mockRejectedValueOnce(new Error('egress already gone'));

		const result = await livekitService.stopSessionEgress(10);

		expect(result).toMatchObject({ egressId: 'EG_boom', error: 'egress already gone' });
	});
});
