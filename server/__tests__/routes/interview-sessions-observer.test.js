/**
 * Task 5 (#323) — Track B observer endpoints (RED).
 *
 * POST /interview-sessions/:id/observer/enable — hiring-team-only toggle,
 *   consent-gated (403 CONSENT_REQUIRED without candidate consent, and the
 *   observer agent is never dispatched).
 * POST /interview-sessions/:id/observer/report — runs extractQAPairs +
 *   analyzeObserverSession over config.observer_transcript; 422 when there
 *   is no transcript.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const userId = parseInt(req.headers['x-test-user-id'], 10);
		const user = global.__testUsers?.[userId];
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		req.user = user;
		return next();
	});
	return { authMiddleware };
});

// ─── External boundaries ─────────────────────────────────────────────────────
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: jest.fn(),
	selectQuestionSource: jest.fn(() => 'template'),
	TURN_TIMEOUT_MS: 20000,
}));
const mockGenerateScreeningReport = jest.fn(async () => ({
	overall_score: 80,
	recommendation: 'advance',
}));
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...a) => mockGenerateScreeningReport(...a),
	runMultiEvaluation: jest.fn(async () => ({})),
}));
jest.mock('../../../lib/ai-provider', () => ({ transcribeAudio: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({ textToSpeech: jest.fn() }));
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn() }));
jest.mock('../../../routes/audit', () => ({ insertAuditLog: jest.fn(async () => ({})) }));

const mockFindRecordingBySessionId = jest.fn();
const mockHasActiveConsent = jest.fn();
const mockDispatchVoiceAgent = jest.fn();
const mockStartSessionEgress = jest.fn();
const mockStopSessionEgress = jest.fn();
const mockCompleteRecordingRecord = jest.fn();
jest.mock('../../services/livekit', () => ({
	findRecordingBySessionId: (...a) => mockFindRecordingBySessionId(...a),
	hasActiveConsent: (...a) => mockHasActiveConsent(...a),
	dispatchVoiceAgent: (...a) => mockDispatchVoiceAgent(...a),
	startSessionEgress: (...a) => mockStartSessionEgress(...a),
	stopSessionEgress: (...a) => mockStopSessionEgress(...a),
	completeRecordingRecord: (...a) => mockCompleteRecordingRecord(...a),
	getRecordingRetentionDate: () => new Date('2026-01-01T00:00:00Z'),
}));

const mockExtractQAPairs = jest.fn();
const mockAnalyzeObserverSession = jest.fn();
jest.mock('../../../services/qa-extraction', () => ({
	extractQAPairs: (...a) => mockExtractQAPairs(...a),
	analyzeObserverSession: (...a) => mockAnalyzeObserverSession(...a),
}));

// ─── In-memory DB ────────────────────────────────────────────────────────────
const mockSessions = new Map();
function seedSession(overrides = {}) {
	const id = mockSessions.size + 1;
	const row = {
		id,
		type: 'ai_interview',
		job_id: 11,
		application_id: 21,
		candidate_id: 4,
		company_id: 2,
		status: 'in_progress',
		config: {},
		conversation: [],
		...overrides,
	};
	mockSessions.set(id, row);
	return row;
}

jest.mock('../../../lib/db', () => ({
	query: jest.fn(async (sql, params = []) => {
		const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (n.startsWith('select * from interview_sessions where id =')) {
			const row = mockSessions.get(Number(params[0]));
			return { rows: row ? [{ ...row }] : [] };
		}
		if (n.startsWith('update interview_sessions set config =')) {
			// M1 (#323): the route writes `config = config || $1::jsonb` —
			// merge top-level keys, mirroring real Postgres semantics.
			const row = mockSessions.get(Number(params[1]));
			if (row) row.config = { ...(row.config || {}), ...JSON.parse(params[0]) };
			return { rows: row ? [{ ...row }] : [] };
		}
		if (n.startsWith("update interview_sessions set status = 'completed'")) {
			// I1 (#323): the complete endpoint writes
			// `SET status='completed', completed_at=NOW(), conversation=$1,
			// config=config||$2::jsonb WHERE id=$3` — mirror it.
			const row = mockSessions.get(Number(params[2]));
			if (row) {
				row.status = 'completed';
				row.completed_at = new Date().toISOString();
				row.conversation = JSON.parse(params[0]);
				row.config = { ...(row.config || {}), ...JSON.parse(params[1]) };
			}
			return { rows: row ? [{ ...row }] : [] };
		}
		if (n.includes('from interview_flows')) {
			return { rows: [{ rubric_weights: { can_do_the_work: 60, communication_quality: 40 } }] };
		}
		if (n.includes('from jobs where id =')) {
			return { rows: [{ title: 'Data Analyst', description: 'SQL dashboards' }] };
		}
		return { rows: [] };
	}),
}));

const router = require('../../../routes/interview-sessions');

const app = express();
app.use(express.json());
app.use(router);

global.__testUsers = {
	1: { id: 1, role: 'recruiter', company_id: 2, email: 'r@x.com' },
	4: { id: 4, role: 'candidate', company_id: null, email: 'c@x.com' },
	9: { id: 9, role: 'recruiter', company_id: 99, email: 'other@x.com' },
};
const as = (id) => ({ 'x-test-user-id': String(id) });

beforeEach(() => {
	mockSessions.clear();
	mockFindRecordingBySessionId.mockReset();
	mockHasActiveConsent.mockReset();
	mockDispatchVoiceAgent.mockReset();
	mockStartSessionEgress.mockReset();
	mockExtractQAPairs.mockReset();
	mockAnalyzeObserverSession.mockReset();
	mockGenerateScreeningReport.mockReset();
	mockStopSessionEgress.mockReset();
	mockCompleteRecordingRecord.mockReset();
	mockStopSessionEgress.mockResolvedValue(null);
	mockFindRecordingBySessionId.mockResolvedValue({ id: 55 });
	mockHasActiveConsent.mockResolvedValue(true);
	mockDispatchVoiceAgent.mockResolvedValue({ dispatched: true });
	mockStartSessionEgress.mockResolvedValue({ egressId: 'EG_mock' });
});

describe('POST /interview-sessions/:id/observer/enable', () => {
	test('hiring team with candidate consent enables the observer and dispatches the agent', async () => {
		const s = seedSession({ config: { biometric_collection: true } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(res.body.observer_enabled).toBe(true);
		expect(mockDispatchVoiceAgent).toHaveBeenCalledWith(s.id, 'observer');
		expect(mockSessions.get(s.id).config.observer_enabled).toBe(true);
	});

	test('no candidate consent → 403 CONSENT_REQUIRED and the agent is never dispatched', async () => {
		// S-046: biometric gate passes (explicit consent), recording consent fails.
		const s = seedSession({ config: { biometric_collection: true } });
		mockHasActiveConsent.mockResolvedValue(false);

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
		expect(mockSessions.get(s.id).config.observer_enabled).not.toBe(true);
	});

	test('missing recording row → 403 consent required, no dispatch', async () => {
		const s = seedSession();
		mockFindRecordingBySessionId.mockResolvedValue(null);

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('the candidate cannot enable the observer on their own session', async () => {
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(4));

		expect(res.status).toBe(403);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('cross-company recruiter cannot enable the observer', async () => {
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(9));

		expect(res.status).toBe(403);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('observer can be enabled on an invited session (before the candidate starts)', async () => {
		const s = seedSession({ status: 'invited', config: { biometric_collection: true } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockDispatchVoiceAgent).toHaveBeenCalledWith(s.id, 'observer');
	});

	test('completed session → 409, no dispatch', async () => {
		const s = seedSession({ status: 'completed' });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(409);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('dispatch failure → 502 and the flag stays unset', async () => {
		const s = seedSession({ config: { biometric_collection: true } });
		mockDispatchVoiceAgent.mockRejectedValue(new Error('LiveKit down'));

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(502);
		expect(mockSessions.get(s.id).config.observer_enabled).not.toBe(true);
	});

	test('starts session egress after enabling, consent-gated on the candidate (Task 6)', async () => {
		const s = seedSession({ config: { biometric_collection: true } }); // candidate_id 4

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockStartSessionEgress).toHaveBeenCalledTimes(1);
		expect(mockStartSessionEgress).toHaveBeenCalledWith(s.id, { consentUserId: 4 });
	});

	test('an egress start failure does not fail observer enable (human call is primary)', async () => {
		const s = seedSession({ config: { biometric_collection: true } });
		mockStartSessionEgress.mockRejectedValueOnce(new Error('storage not configured'));

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(res.body.observer_enabled).toBe(true);
	});
});

describe('POST /interview-sessions/:id/observer/enable — biometric consent gate (S-070, #724)', () => {
	test('biometric_collection: false → 403 BIOMETRIC_CONSENT_DECLINED, agent never dispatched (AC-1, AC-2, AC-4)', async () => {
		const s = seedSession({ config: { biometric_collection: false } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('BIOMETRIC_CONSENT_DECLINED');
		expect(typeof res.body.error).toBe('string');
		expect(res.body.error).toMatch(/declined/i);
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
		expect(mockSessions.get(s.id).config.observer_enabled).not.toBe(true);
	});

	test('biometric decline blocks even with active recording consent (gate is independent)', async () => {
		const s = seedSession({ config: { biometric_collection: false } });
		mockHasActiveConsent.mockResolvedValue(true);

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('BIOMETRIC_CONSENT_DECLINED');
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('biometric_collection: true → observer enables normally (AC-3)', async () => {
		const s = seedSession({ config: { biometric_collection: true } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(res.body.observer_enabled).toBe(true);
		expect(mockDispatchVoiceAgent).toHaveBeenCalledWith(s.id, 'observer');
	});

	test('biometric_collection unset → 403 BIOMETRIC_CONSENT_UNKNOWN (S-046 default-deny)', async () => {
		const s = seedSession({ config: {} });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('S-046 BLOCKER 1: default-created human session (observer_enabled=true, consent null) → 403 UNKNOWN, gate not bypassed', async () => {
		// Production-default shape via ModeAdapter: observer_enabled defaults
		// true (recruiter intent), biometric_collection defaults null (unknown).
		// The enable route must run the gate BEFORE the already_enabled
		// short-circuit — otherwise the schema default bypasses consent.
		const { ModeAdapter } = require('../../../shared/interview-modes/modes');
		const defaultConfig = ModeAdapter.buildConfig('human', {});
		expect(defaultConfig.observer_enabled).toBe(true);
		expect(defaultConfig.biometric_collection).toBe(null);
		const s = seedSession({ config: defaultConfig });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('BIOMETRIC_CONSENT_UNKNOWN');
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('S-046: explicit grant on default-created session → already_enabled (intent recorded, no redundant dispatch)', async () => {
		const { ModeAdapter } = require('../../../shared/interview-modes/modes');
		const defaultConfig = ModeAdapter.buildConfig('human', {});
		const s = seedSession({ config: { ...defaultConfig, biometric_collection: true } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(res.body.observer_enabled).toBe(true);
		expect(res.body.already_enabled).toBe(true);
		// Intent already recorded by schema default. The enable route is
		// idempotent on the flag; actual observer dispatch is gated
		// separately (livekit dispatch route, S-047 worker when built).
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});

	test('S-046: already_enabled + granted consent → allowed without re-dispatch', async () => {
		const s = seedSession({ config: { observer_enabled: true, biometric_collection: true } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/enable`).set(as(1));

		expect(res.status).toBe(200);
		expect(res.body.already_enabled).toBe(true);
		// Gate passed, flag already set — no redundant dispatch.
		expect(mockDispatchVoiceAgent).not.toHaveBeenCalled();
	});
});

describe('POST /interview-sessions/:id/observer/report', () => {
	test('runs extraction + analysis over the observer transcript and stores the report', async () => {
		const transcript = [{ speaker: 'recruiter-1', text: 'Tell me about yourself.', at: 'x' }];
		const s = seedSession({ config: { observer_transcript: transcript } });
		const pairs = [
			{
				question: 'Tell me about yourself.',
				answer: 'I am a data analyst.',
				asker: 'recruiter-1',
				answerer: 'candidate-4',
			},
		];
		mockExtractQAPairs.mockResolvedValue(pairs);
		mockAnalyzeObserverSession.mockResolvedValue({
			overall_score: 82,
			recommendation: 'advance',
			rubric_source: 'recruiter',
		});

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/report`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockExtractQAPairs).toHaveBeenCalledWith(transcript);
		expect(mockAnalyzeObserverSession).toHaveBeenCalledWith({
			session: expect.objectContaining({ id: s.id }),
			qaPairs: pairs,
			rubricWeights: { can_do_the_work: 60, communication_quality: 40 },
			job: { title: 'Data Analyst', description: 'SQL dashboards' },
		});
		expect(res.body.report.overall_score).toBe(82);
		expect(mockSessions.get(s.id).config.report.overall_score).toBe(82);
	});

	test('no observer transcript → 422', async () => {
		const s = seedSession({ config: {} });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/report`).set(as(1));

		expect(res.status).toBe(422);
		expect(mockExtractQAPairs).not.toHaveBeenCalled();
	});

	test('cross-company recruiter cannot generate the report', async () => {
		const s = seedSession({ config: { observer_transcript: [{ speaker: 'a', text: 'b' }] } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/report`).set(as(9));

		expect(res.status).toBe(403);
	});
});

// S-083 (#783): canonical path is .../observer/qa-report; the old
// .../observer/report path stays as a deprecated alias for one sprint
// (Decision D1, Option A). Both paths serve the identical handler.
describe('POST /interview-sessions/:id/observer/qa-report (S-083 canonical path)', () => {
	const transcript = [{ speaker: 'recruiter-1', text: 'Tell me about yourself.', at: 'x' }];
	const pairs = [
		{
			question: 'Tell me about yourself.',
			answer: 'I am a data analyst.',
			asker: 'recruiter-1',
			answerer: 'candidate-4',
		},
	];
	const report = {
		overall_score: 82,
		recommendation: 'advance',
		rubric_source: 'recruiter',
	};

	test('runs extraction + analysis over the observer transcript and stores the report', async () => {
		const s = seedSession({ config: { observer_transcript: transcript } });
		mockExtractQAPairs.mockResolvedValue(pairs);
		mockAnalyzeObserverSession.mockResolvedValue(report);

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/qa-report`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockExtractQAPairs).toHaveBeenCalledWith(transcript);
		expect(mockAnalyzeObserverSession).toHaveBeenCalledWith({
			session: expect.objectContaining({ id: s.id }),
			qaPairs: pairs,
			rubricWeights: { can_do_the_work: 60, communication_quality: 40 },
			job: { title: 'Data Analyst', description: 'SQL dashboards' },
		});
		expect(res.body).toEqual({ success: true, report, qa_pair_count: 1 });
		expect(mockSessions.get(s.id).config.report.overall_score).toBe(82);
	});

	test('no observer transcript → 422', async () => {
		const s = seedSession({ config: {} });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/qa-report`).set(as(1));

		expect(res.status).toBe(422);
		expect(mockExtractQAPairs).not.toHaveBeenCalled();
	});

	test('cross-company recruiter cannot generate the report', async () => {
		const s = seedSession({ config: { observer_transcript: [{ speaker: 'a', text: 'b' }] } });

		const res = await request(app).post(`/interview-sessions/${s.id}/observer/qa-report`).set(as(9));

		expect(res.status).toBe(403);
	});

	test('canonical and deprecated-alias paths return identical responses', async () => {
		mockExtractQAPairs.mockResolvedValue(pairs);
		mockAnalyzeObserverSession.mockResolvedValue(report);
		const sNew = seedSession({ config: { observer_transcript: transcript } });
		const sOld = seedSession({ config: { observer_transcript: transcript } });

		const resNew = await request(app).post(`/interview-sessions/${sNew.id}/observer/qa-report`).set(as(1));
		const resOld = await request(app).post(`/interview-sessions/${sOld.id}/observer/report`).set(as(1));

		expect(resNew.status).toBe(200);
		expect(resOld.status).toBe(200);
		expect(resNew.body).toEqual(resOld.body);
	});
});

describe("POST /interview-sessions/:id/complete — 'human' without observer data (I1, #323)", () => {
	test('human session with no observer transcript → no-data report, LLM never called', async () => {
		const s = seedSession({ type: 'human', config: {} });

		const res = await request(app).post(`/interview-sessions/${s.id}/complete`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockGenerateScreeningReport).not.toHaveBeenCalled();
		expect(res.body.report.overall_score).toBeNull();
		expect(res.body.report.note).toMatch(/observer/i);
		expect(mockSessions.get(s.id).status).toBe('completed');
	});

	test('non-human session without observer data still runs the standard report', async () => {
		const s = seedSession({ type: 'screening', config: {} });

		const res = await request(app).post(`/interview-sessions/${s.id}/complete`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockGenerateScreeningReport).toHaveBeenCalled();
	});
});

describe('POST /interview-sessions/:id/complete — egress backfill (I2, #323)', () => {
	test('stopSessionEgress fileLocation → completeRecordingRecord writes storage_path + duration', async () => {
		const s = seedSession({ type: 'screening', config: {} });
		mockStopSessionEgress.mockResolvedValue({
			egressId: 'EG_1',
			status: 'EGRESS_COMPLETE',
			fileLocation: 's3://test-bucket/rekrut-recordings/interview-1-123.mp4',
			durationSeconds: 120,
			fileSizeBytes: 1048576,
		});

		const res = await request(app).post(`/interview-sessions/${s.id}/complete`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockStopSessionEgress).toHaveBeenCalledWith(s.id);
		expect(mockCompleteRecordingRecord).toHaveBeenCalledWith(
			55,
			's3://test-bucket/rekrut-recordings/interview-1-123.mp4',
			120,
			1048576,
		);
	});

	test('no fileLocation → no backfill call', async () => {
		const s = seedSession({ type: 'screening', config: {} });
		mockStopSessionEgress.mockResolvedValue({ egressId: 'EG_1', status: 'EGRESS_COMPLETE' });

		const res = await request(app).post(`/interview-sessions/${s.id}/complete`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockCompleteRecordingRecord).not.toHaveBeenCalled();
	});
});
