/**
 * Feature Flags Configuration
 *
 * Centralizes feature toggles for the Rekrut AI platform.
 * All flags are env-driven with safe defaults (off in production unless explicitly enabled).
 */

const features = {
	/**
	 * Route analytics queries to ClickHouse when available.
	 * Default: false — keeps PostgreSQL as the analytics backend until
	 * ClickHouse is provisioned, migrated, and manually enabled.
	 */
	useClickHouseAnalytics: process.env.USE_CLICKHOUSE_ANALYTICS === 'true',
};

/**
 * Check if a feature is enabled.
 */
function isEnabled(featureName) {
	return !!features[featureName];
}

/**
 * Get all feature flags (for admin/debug endpoints).
 */
function getAll() {
	return { ...features };
}

module.exports = {
	features,
	isEnabled,
	getAll,
};
