/**
 * observerEnvIdentity — dedicated environment-identity stamp (Gate A, S-085 #787).
 *
 * Why this module exists (STOP 1 evidence on #787, 2026-10-13): NODE_ENV
 * does NOT distinguish staging from production in this deployment — a
 * Render API query showed NODE_ENV unset on BOTH the staging and the
 * production services (dev carries 'development'). Any runtime default
 * therefore applies equally to staging and prod, and an env check built on
 * NODE_ENV alone cannot keep a production worker from treating a staging
 * job as its own (or vice versa). Design D-1 requires a dedicated stamp.
 *
 * Resolution order (first hit wins):
 *   1. REKRUT_ENV_IDENTITY — explicit stamp, when set to a recognised
 *      value. An UNRECOGNISED explicit value fails closed to 'unknown'
 *      (a misconfigured stamp must never fall through to weaker signals).
 *   2. RENDER_SERVICE_NAME — injected by Render at runtime, needs no env
 *      change: rekrutai-prod → production, rekrutai-staging → staging,
 *      rekrutai-dev → development.
 *   3. NODE_ENV — normalised (production/staging/development/test).
 *   4. 'unknown' — capture-ineligible everywhere it is consumed.
 *
 * The stamp is written onto observer_jobs.origin_env at job creation and
 * compared, exactly, by the capture gate (G-ENV) and re-checked inside
 * the chunk-persist transaction.
 */

const RECOGNISED = ['production', 'staging', 'development', 'test'];

const SERVICE_NAME_MAP = {
	'rekrutai-prod': 'production',
	'rekrutai-staging': 'staging',
	'rekrutai-dev': 'development',
};

function resolveEnvIdentity(env = process.env) {
	const explicit = String(env.REKRUT_ENV_IDENTITY || '').trim().toLowerCase();
	if (explicit) {
		return RECOGNISED.includes(explicit) ? explicit : 'unknown';
	}

	const serviceName = String(env.RENDER_SERVICE_NAME || '').trim();
	if (serviceName && SERVICE_NAME_MAP[serviceName]) {
		return SERVICE_NAME_MAP[serviceName];
	}

	const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
	if (nodeEnv === 'production') return 'production';
	if (nodeEnv === 'staging') return 'staging';
	if (nodeEnv === 'development' || nodeEnv === 'dev') return 'development';
	if (nodeEnv === 'test') return 'test';

	return 'unknown';
}

module.exports = { resolveEnvIdentity, RECOGNISED, SERVICE_NAME_MAP };
