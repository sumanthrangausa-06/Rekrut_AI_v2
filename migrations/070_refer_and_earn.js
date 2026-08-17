// Migration: Refer & Earn — referral codes, tracking, rewards (#80)

async function up(client) {
	// ─── referrals ─────────────────────────────────────────────────────────
	await client.query(`
		CREATE TABLE IF NOT EXISTS referrals (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			referral_code VARCHAR(50) NOT NULL UNIQUE,
			referred_email VARCHAR(255),
			referred_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'converted')),
			reward_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (reward_status IN ('pending', 'claimed', 'paid')),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			converted_at TIMESTAMPTZ
		)
	`);

	// ─── referral_rewards ──────────────────────────────────────────────────
	await client.query(`
		CREATE TABLE IF NOT EXISTS referral_rewards (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			referral_id UUID REFERENCES referrals(id) ON DELETE SET NULL,
			reward_type VARCHAR(20) NOT NULL CHECK (reward_type IN ('credits', 'premium_days')),
			amount INTEGER NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'paid')),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			claimed_at TIMESTAMPTZ
		)
	`);

	// ─── Indexes ───────────────────────────────────────────────────────────
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_referrals_referrer
		ON referrals(referrer_id, created_at DESC)
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_referrals_code
		ON referrals(referral_code)
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_referrals_referred_user
		ON referrals(referred_user_id) WHERE referred_user_id IS NOT NULL
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_referral_rewards_user
		ON referral_rewards(user_id, status, created_at DESC)
	`);

	console.log('[migration 070] Refer & Earn tables created');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS referral_rewards CASCADE');
	await client.query('DROP TABLE IF EXISTS referrals CASCADE');
	console.log('[migration 070] Refer & Earn tables dropped');
}

module.exports = { up, down };
