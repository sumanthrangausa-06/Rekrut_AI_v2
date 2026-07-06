// Settings API Routes — Unified endpoint for profile, notifications, privacy, avatar
// Fixes: GitHub issue #18 — Settings notifications API missing
const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../lib/auth');
const pool = require('../lib/db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const DEFAULT_NOTIFICATIONS = {
	email_jobs: true,
	email_applications: true,
	email_messages: true,
	email_marketing: false,
	push_jobs: true,
	push_messages: true,
	push_reminders: true,
};

const DEFAULT_PRIVACY = {
	profile_visible: true,
	allow_messages: true,
	share_analytics: false,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getOrCreateSettings(userId) {
	const result = await pool.query(
		'SELECT notifications, privacy FROM user_settings WHERE user_id = $1',
		[userId],
	);
	if (result.rows.length > 0) {
		return {
			notifications: { ...DEFAULT_NOTIFICATIONS, ...result.rows[0].notifications },
			privacy: { ...DEFAULT_PRIVACY, ...result.rows[0].privacy },
		};
	}
	// Create default row
	await pool.query(
		`INSERT INTO user_settings (user_id, notifications, privacy)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
		[userId, JSON.stringify(DEFAULT_NOTIFICATIONS), JSON.stringify(DEFAULT_PRIVACY)],
	);
	return { notifications: DEFAULT_NOTIFICATIONS, privacy: DEFAULT_PRIVACY };
}

// ─── GET /api/settings ─────────────────────────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;

		// Get user basics
		const userResult = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [
			userId,
		]);
		if (userResult.rows.length === 0) {
			return res.status(404).json({ error: 'User not found' });
		}

		// Get profile from candidate_profiles
		const profileResult = await pool.query(
			'SELECT bio, location, photo_url FROM candidate_profiles WHERE user_id = $1',
			[userId],
		);

		// Get settings
		const settings = await getOrCreateSettings(userId);

		res.json({
			success: true,
			profile: {
				bio: profileResult.rows[0]?.bio || '',
				location: profileResult.rows[0]?.location || '',
			},
			notifications: settings.notifications,
			privacy: settings.privacy,
		});
	} catch (err) {
		console.error('[settings] GET error:', err.message);
		res.status(500).json({ error: 'Failed to load settings' });
	}
});

// ─── PATCH /api/settings/profile ───────────────────────────────────────────

router.patch('/profile', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const { name, email, bio, location } = req.body;

		// Update users table
		if (name || email) {
			await pool.query(
				'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3',
				[name, email, userId],
			);
		}

		// Upsert candidate_profiles
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, bio, location)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET
         bio = COALESCE(NULLIF($2, ''), candidate_profiles.bio),
         location = COALESCE(NULLIF($3, ''), candidate_profiles.location),
         updated_at = NOW()`,
			[userId, bio || '', location || ''],
		);

		res.json({ success: true, message: 'Profile updated' });
	} catch (err) {
		console.error('[settings] Profile update error:', err.message);
		res.status(500).json({ error: 'Failed to update profile' });
	}
});

// ─── PATCH /api/settings/notifications ───────────────────────────────────────

router.patch('/notifications', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const notifications = req.body;

		if (!notifications || typeof notifications !== 'object') {
			return res.status(400).json({ error: 'Invalid notifications data' });
		}

		await pool.query(
			`INSERT INTO user_settings (user_id, notifications)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET
         notifications = EXCLUDED.notifications,
         updated_at = NOW()`,
			[userId, JSON.stringify(notifications)],
		);

		res.json({ success: true, message: 'Notification preferences updated' });
	} catch (err) {
		console.error('[settings] Notifications update error:', err.message);
		res.status(500).json({ error: 'Failed to update notifications' });
	}
});

// ─── PATCH /api/settings/privacy ─────────────────────────────────────────────

router.patch('/privacy', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const privacy = req.body;

		if (!privacy || typeof privacy !== 'object') {
			return res.status(400).json({ error: 'Invalid privacy data' });
		}

		await pool.query(
			`INSERT INTO user_settings (user_id, privacy)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET
         privacy = EXCLUDED.privacy,
         updated_at = NOW()`,
			[userId, JSON.stringify(privacy)],
		);

		res.json({ success: true, message: 'Privacy settings updated' });
	} catch (err) {
		console.error('[settings] Privacy update error:', err.message);
		res.status(500).json({ error: 'Failed to update privacy settings' });
	}
});

// ─── POST /api/settings/avatar ─────────────────────────────────────────────

router.post('/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
	try {
		const userId = req.user.id;
		const file = req.file;

		if (!file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}

		if (!file.mimetype.startsWith('image/')) {
			return res.status(400).json({ error: 'Only image files are allowed' });
		}

		// For now, return a data URL or placeholder URL
		// In production, upload to S3/Cloudinary and return the URL
		const base64 = file.buffer.toString('base64');
		const avatar_url = `data:${file.mimetype};base64,${base64}`;

		// Update candidate_profiles photo_url
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, photo_url)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET photo_url = $2, updated_at = NOW()`,
			[userId, avatar_url],
		);

		res.json({ success: true, avatar_url });
	} catch (err) {
		console.error('[settings] Avatar upload error:', err.message);
		res.status(500).json({ error: 'Failed to upload avatar' });
	}
});

module.exports = router;
