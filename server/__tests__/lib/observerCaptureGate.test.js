/**
 * observerCaptureGate — Gate A (S-085 #787), Quinn protocol T4/T4b/T4c/T14.
 * The gate is fail-closed in every dimension; January's biometric consent
 * can never satisfy the distinct observer_capture artefact (T4b centrepiece).
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const gate = require('../../../lib/observerCaptureGate');

const GRANTED = { allowed: true };
const DECLINED = { allowed: false, code: 'BIOMETRIC_CONSENT_DECLINED' };
const STAGING = { OBSERVER_AUDIO_CAPTURE_ENABLED: 'true', RENDER_SERVICE_NAME: 'rekrutai-staging' };
const PROD = { OBSERVER_AUDIO_CAPTURE_ENABLED: 'true', RENDER_SERVICE_NAME: 'rekrutai-prod' };

function makeDb(state) {
	const calls = [];
	return {
		calls,
		query: async (sql, params = []) => {
			calls.push(sql);
			if (sql.includes('FROM consent_texts')) return { rows: state.artefactVersion ? [{ version: state.artefactVersion }] : [] };
			if (sql.includes('FROM consent_receipts')) {
				if (params[1] === 'observer_capture') return { rows: state.captureReceipt ? [state.captureReceipt] : [] };
				return { rows: state.biometricReceipt ? [state.biometricReceipt] : [] };
			}
			if (sql.includes('FROM observer_activation_enablements')) return { rows: state.enablement && (params[0] == null || state.enablement.company_id === params[0]) ? [state.enablement] : [] };
			if (sql.includes('FROM observer_cohort_membership')) return { rows: state.membership && state.membership.source !== 'test_harness' ? [state.membership] : [] };
			if (sql.includes('FROM observer_cohort_allowlist')) return { rows: state.allowlisted ? [{ allowlist_version: state.allowlisted }] : [] };
			if (sql.includes('INSERT INTO observer_cohort_membership')) { state.snapshotInserted = params; return { rows: [], rowCount: 1 }; }
			if (sql.includes('FROM interview_sessions')) return { rows: state.sessionRow ? [state.sessionRow] : [] };
			return { rows: [] };
		},
	};
}
const session = (over = {}) => ({ id: 42, candidate_id: 7, company_id: 99, config: { biometric_collection: true }, ...over });
const testSession = () => session({ config: { biometric_collection: true, observer_capture_test: true } });
const job = (origin = 'staging') => ({ id: 9, origin_env: origin });
const VALID_ACTIVATION = {
	artefactVersion: '1.0',
	captureReceipt: { granted_at: new Date('2026-10-01'), withdrawn_at: null, consent_text_version: '1.0' },
	enablement: { company_id: 99, enabled_at: new Date('2026-09-01') },
	membership: { is_member: true, allowlist_version: 3 },
};

describe('evaluateCaptureDecision', () => {
	test('T4: flag OFF ⇒ dormant, and the gate issues ZERO database queries', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: {} });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBeNull();
		expect(db.calls).toHaveLength(0);
	});

	test('T4: malformed flag value is OFF', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: { OBSERVER_AUDIO_CAPTURE_ENABLED: 'TRUE', RENDER_SERVICE_NAME: 'rekrutai-staging' } });
		expect(d.decision).toBe('dormant');
	});

	test('unknown env identity (no stamp signals) ⇒ CAPTURE_ENV_UNKNOWN', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job('unknown'), presence: GRANTED, queryable: db, env: { OBSERVER_AUDIO_CAPTURE_ENABLED: 'true' } });
		expect(d.gateCode).toBe('CAPTURE_ENV_UNKNOWN');
	});

	test('T14: production-stamped job + staging worker ⇒ CAPTURE_ENV_MISMATCH', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job('production'), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBe('CAPTURE_ENV_MISMATCH');
	});

	test('test scope: marker + non-production + presence ⇒ capturing/test', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: testSession(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d).toMatchObject({ decision: 'capturing', scope: 'test' });
	});

	test('T4c: production worker rejects test scope outright', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: testSession(), job: job('production'), presence: GRANTED, queryable: db, env: PROD });
		expect(d.gateCode).toBe('CAPTURE_TEST_SCOPE_ON_PRODUCTION');
	});

	test('P-3: a forged identity claim cannot re-point the production SERVICE into test scope', async () => {
		// REKRUT_ENV_IDENTITY='test' wins identity resolution, and the job is
		// stamped 'test' to match — but the platform-injected service name
		// is rekrutai-prod, which is an absolute veto (privacy review P-3).
		const db = makeDb({});
		const forged = { OBSERVER_AUDIO_CAPTURE_ENABLED: 'true', REKRUT_ENV_IDENTITY: 'test', RENDER_SERVICE_NAME: 'rekrutai-prod' };
		const d = await gate.evaluateCaptureDecision({ session: testSession(), job: job('test'), presence: GRANTED, queryable: db, env: forged });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBe('CAPTURE_TEST_SCOPE_ON_PRODUCTION');
		const rc = await gate.recheckCaptureGate({ sessionId: 42, candidateId: 7, scope: 'test', jobOriginEnv: 'test', queryable: makeDb({ sessionRow: { id: 42, config: { biometric_collection: true } } }), env: forged });
		expect(rc).toMatchObject({ ok: false, gateCode: 'CAPTURE_TEST_SCOPE_ON_PRODUCTION' });
	});

	test('test scope still requires presence', async () => {
		const db = makeDb({});
		const d = await gate.evaluateCaptureDecision({ session: testSession(), job: job(), presence: DECLINED, queryable: db, env: STAGING });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBe('BIOMETRIC_CONSENT_DECLINED');
	});

	test('T4b: January biometric consent (granted) with NO observer_capture artefact ⇒ CAPTURE_CONSENT_MISSING', async () => {
		const db = makeDb({ artefactVersion: null, captureReceipt: null });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBe('CAPTURE_CONSENT_MISSING');
	});

	test('T4b: banked consent at stale text version ⇒ CAPTURE_CONSENT_STALE_VERSION', async () => {
		const db = makeDb({ ...VALID_ACTIVATION, artefactVersion: '2.0' });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.gateCode).toBe('CAPTURE_CONSENT_STALE_VERSION');
	});

	test('T4b: consent granted BEFORE the enablement ⇒ CAPTURE_CONSENT_BEFORE_ENABLEMENT', async () => {
		const db = makeDb({ ...VALID_ACTIVATION, captureReceipt: { granted_at: new Date('2026-08-01'), withdrawn_at: null, consent_text_version: '1.0' } });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.gateCode).toBe('CAPTURE_CONSENT_BEFORE_ENABLEMENT');
	});

	test('T4b: no enablement row at all ⇒ CAPTURE_CONSENT_BEFORE_ENABLEMENT', async () => {
		const db = makeDb({ ...VALID_ACTIVATION, enablement: null });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.gateCode).toBe('CAPTURE_CONSENT_BEFORE_ENABLEMENT');
	});

	test('T4b: withdrawn capture consent ⇒ CAPTURE_CONSENT_WITHDRAWN', async () => {
		const db = makeDb({ ...VALID_ACTIVATION, captureReceipt: { granted_at: new Date('2026-10-01'), withdrawn_at: new Date('2026-10-05'), consent_text_version: '1.0' } });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.gateCode).toBe('CAPTURE_CONSENT_WITHDRAWN');
	});

	test('M1: an enablement belonging to a DIFFERENT employer does not count', async () => {
		const db = makeDb({ ...VALID_ACTIVATION, enablement: { company_id: 55, enabled_at: new Date('2026-09-01') } });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBe('CAPTURE_CONSENT_BEFORE_ENABLEMENT');
	});

	test('activation happy path: artefact + fresh consent + cohort member ⇒ capturing/activation', async () => {
		const db = makeDb({ ...VALID_ACTIVATION });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d).toMatchObject({ decision: 'capturing', scope: 'activation' });
	});

	test('T4c: valid consent but NOT in cohort ⇒ dormant', async () => {
		const db = makeDb({ ...VALID_ACTIVATION, membership: { is_member: false, allowlist_version: 3 } });
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.decision).toBe('dormant');
		expect(d.gateCode).toBe('CAPTURE_NOT_IN_COHORT');
	});

	test('cohort resolves from the allow-list and writes the decision snapshot', async () => {
		const state = { ...VALID_ACTIVATION, membership: null, allowlisted: 5 };
		const db = makeDb(state);
		const d = await gate.evaluateCaptureDecision({ session: session(), job: job(), presence: GRANTED, queryable: db, env: STAGING });
		expect(d.decision).toBe('capturing');
		expect(state.snapshotInserted.slice(1, 4)).toEqual([99, true, 5]);
	});
});

describe('recheckCaptureGate', () => {
	const base = { sessionRow: { id: 42, config: { biometric_collection: true } }, artefactVersion: '1.0', captureReceipt: { granted_at: new Date('2026-10-01'), withdrawn_at: null, consent_text_version: '1.0' } };

	test('happy path ⇒ ok', async () => {
		const db = makeDb({ ...base });
		const rc = await gate.recheckCaptureGate({ sessionId: 42, candidateId: 7, scope: 'activation', jobOriginEnv: 'staging', queryable: db, env: STAGING });
		expect(rc.ok).toBe(true);
	});

	test('flag flipped off ⇒ kind flag_off', async () => {
		const db = makeDb({ ...base });
		const rc = await gate.recheckCaptureGate({ sessionId: 42, candidateId: 7, scope: 'activation', jobOriginEnv: 'staging', queryable: db, env: { RENDER_SERVICE_NAME: 'rekrutai-staging' } });
		expect(rc).toMatchObject({ ok: false, kind: 'flag_off' });
	});

	test('receipt withdrawn mid-capture ⇒ kind withdrawn', async () => {
		const db = makeDb({ ...base, sessionRow: { id: 42, config: { biometric_collection: false } }, captureReceipt: { granted_at: new Date('2026-10-01'), withdrawn_at: new Date(), consent_text_version: '1.0' } });
		const rc = await gate.recheckCaptureGate({ sessionId: 42, candidateId: 7, scope: 'activation', jobOriginEnv: 'staging', queryable: db, env: STAGING });
		expect(rc).toMatchObject({ ok: false, kind: 'withdrawn', gateCode: 'CAPTURE_CONSENT_WITHDRAWN' });
	});
});
