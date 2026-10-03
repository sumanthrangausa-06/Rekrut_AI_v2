const express = require('express');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateReferralCode() {
	// 8-character alphanumeric code — ~2.8 trillion combinations
	return crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, 8);
}

// ─── POST /api/referrals/generate ─ Generate unique referral code ────────
// Idempotent: returns existing code if user already has one
router.post('/generate', authMiddleware, async (req, res) => {
	try {
		// Check if user already has a referral code
		const existing = await pool.query(
			'SELECT referral_code FROM referrals WHERE referrer_id = $1 LIMIT 1',
			[req.user.id],
		);

		let code;
		if (existing.rows.length > 0) {
			code = existing.rows[0].referral_code;
		} else {
			// Generate unique code with collision retry
			let inserted = false;
			let attempts = 0;
			while (!inserted && attempts < 5) {
				code = generateReferralCode();
				try {
					await pool.query(
						'INSERT INTO referrals (referrer_id, referral_code, status) VALUES ($1, $2, $3)',
						[req.user.id, code, 'pending'],
					);
					inserted = true;
				} catch (err) {
					if (err.code === '23505') {
						// Unique violation — retry with new code
						attempts++;
					} else {
						throw err;
					}
				}
			}
			if (!inserted) {
				return res.status(500).json({ error: 'Failed to generate referral code' });
			}
		}

		const baseUrl = process.env.FRONTEND_URL || 'https://rekrut.ai';
		res.json({
			success: true,
			referral_code: code,
			referral_link: `${baseUrl}/register?ref=${code}`,
		});
	} catch (err) {
		console.error('[referrals] Generate error:', err.message);
		res.status(500).json({ error: 'Failed to generate referral code' });
	}
});

// ─── GET /api/referrals ─ List my referrals and stats ────────────────────
router.get('/', authMiddleware, async (req, res) => {
	try {
		// Get user's referral code
		const codeResult = await pool.query(
			'SELECT referral_code FROM referrals WHERE referrer_id = $1 LIMIT 1',
			[req.user.id],
		);

		const referralCode = codeResult.rows[0]?.referral_code || null;

		// Get referrals list
		const referralsResult = await pool.query(
			`
			SELECT
				r.id,
				r.referral_code,
				r.referred_email,
				r.referred_user_id,
				r.status,
				r.reward_status,
				r.created_at,
				r.converted_at,
				u.name as referred_name,
				u.email as referred_email_from_user
			FROM referrals r
			LEFT JOIN users u ON u.id = r.referred_user_id
			WHERE r.referrer_id = $1
			ORDER BY r.created_at DESC
			`,
			[req.user.id],
		);

		// Calculate stats
		const statsResult = await pool.query(
			`
			SELECT
				COUNT(*) FILTER (WHERE status = 'pending' AND referred_user_id IS NULL) as invites_sent,
				COUNT(*) FILTER (WHERE status = 'registered' OR referred_user_id IS NOT NULL) as registered,
				COUNT(*) FILTER (WHERE status = 'converted') as converted
			FROM referrals
			WHERE referrer_id = $1
			`,
			[req.user.id],
		);

		// Get rewards
		const rewardsResult = await pool.query(
			`
			SELECT
				rr.id,
				rr.reward_type,
				rr.amount,
				rr.status,
				rr.created_at,
				r.referral_code
			FROM referral_rewards rr
			LEFT JOIN referrals r ON r.id = rr.referral_id
			WHERE rr.user_id = $1
			ORDER BY rr.created_at DESC
			`,
			[req.user.id],
		);

		const totalEarned = rewardsResult.rows
			.filter((r) => r.status === 'claimed' || r.status === 'paid')
			.reduce((sum, r) => sum + r.amount, 0);

		const pendingRewards = rewardsResult.rows.filter((r) => r.status === 'pending');

		const baseUrl = process.env.FRONTEND_URL || 'https://rekrut.ai';

		res.json({
			success: true,
			referral_code: referralCode,
			referral_link: referralCode ? `${baseUrl}/register?ref=${referralCode}` : null,
			stats: {
				invites_sent: parseInt(statsResult.rows[0]?.invites_sent || '0', 10),
				registered: parseInt(statsResult.rows[0]?.registered || '0', 10),
				converted: parseInt(statsResult.rows[0]?.converted || '0', 10),
				total_earned: totalEarned,
				pending_count: pendingRewards.length,
			},
			referrals: referralsResult.rows.map((r) => ({
				...r,
				referred_email: r.referred_email || r.referred_email_from_user,
			})),
			rewards: rewardsResult.rows,
		});
	} catch (err) {
		console.error('[referrals] List error:', err.message);
		res.status(500).json({ error: 'Failed to load referrals' });
	}
});

// ─── POST /api/referrals/claim ─ Claim all pending rewards ───────────────
router.post('/claim', authMiddleware, async (req, res) => {
	try {
		// Update all pending rewards to claimed
		const result = await pool.query(
			`
			UPDATE referral_rewards
			SET status = 'claimed', claimed_at = NOW()
			WHERE user_id = $1 AND status = 'pending'
			RETURNING id, reward_type, amount
			`,
			[req.user.id],
		);

		// Also mark referral reward_status as claimed
		await pool.query(
			`
			UPDATE referrals
			SET reward_status = 'claimed'
			WHERE referrer_id = $1 AND reward_status = 'pending'
			AND id IN (SELECT referral_id FROM referral_rewards WHERE user_id = $1)
			`,
			[req.user.id],
		);

		res.json({
			success: true,
			claimed: result.rows.length,
			rewards: result.rows,
		});
	} catch (err) {
		console.error('[referrals] Claim error:', err.message);
		res.status(500).json({ error: 'Failed to claim rewards' });
	}
});

// ─── POST /api/referrals/track ─ Track referral visit (public) ───────────
// Accepts ref code, sets cookie for attribution
router.post('/track', async (req, res) => {
	try {
		const { ref } = req.body;
		if (!ref || typeof ref !== 'string') {
			return res.status(400).json({ error: 'Referral code required' });
		}

		// Validate code exists
		const codeResult = await pool.query(
			'SELECT id, referrer_id FROM referrals WHERE referral_code = $1',
			[ref.toUpperCase().trim()],
		);

		if (codeResult.rows.length === 0) {
			return res.status(404).json({ error: 'Invalid referral code' });
		}

		// Set attribution cookie — 30 days expiry
		res.cookie('referral_code', ref.toUpperCase().trim(), {
			httpOnly: false, // frontend may read it
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
		});

		res.json({ success: true, message: 'Referral tracked' });
	} catch (err) {
		console.error('[referrals] Track error:', err.message);
		res.status(500).json({ error: 'Failed to track referral' });
	}
});

// ─── POST /api/referrals/attribution ─ Attribute referral during reg ─────
// Called during registration to match code and update referral record
router.post('/attribution', async (req, res) => {
	try {
		const { referral_code, user_id, email } = req.body;
		if (!referral_code || !user_id) {
			return res.status(400).json({ error: 'referral_code and user_id required' });
		}

		// Find the referral by code
		const refResult = await pool.query(
			'SELECT id, referrer_id, referred_user_id FROM referrals WHERE referral_code = $1',
			[referral_code.toUpperCase().trim()],
		);

		if (refResult.rows.length === 0) {
			return res.status(404).json({ error: 'Referral code not found' });
		}

		const referral = refResult.rows[0];

		// Prevent self-referral
		if (referral.referrer_id === parseInt(user_id, 10)) {
			return res.status(400).json({ error: 'Self-referral not allowed' });
		}

		// Don't overwrite existing attribution
		if (referral.referred_user_id) {
			return res.status(200).json({ success: true, message: 'Already attributed' });
		}

		// Update referral record
		await pool.query(
			`
			UPDATE referrals
			SET referred_user_id = $1,
				referred_email = COALESCE($2, referred_email),
				status = 'registered',
				converted_at = NOW()
			WHERE id = $3
			`,
			[user_id, email, referral.id],
		);

		// Create reward record for referrer
		// ponytail: fixed reward of 10 premium days per conversion
		await pool.query(
			`
			INSERT INTO referral_rewards (user_id, referral_id, reward_type, amount, status)
			VALUES ($1, $2, 'premium_days', 10, 'pending')
			`,
			[referral.referrer_id, referral.id],
		);

		res.json({
			success: true,
			message: 'Referral attributed successfully',
			referrer_id: referral.referrer_id,
		});
	} catch (err) {
		console.error('[referrals] Attribution error:', err.message);
		res.status(500).json({ error: 'Failed to attribute referral' });
	}
});

module.exports = router;
