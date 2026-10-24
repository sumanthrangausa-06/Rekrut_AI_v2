/**
 * #1638 — LinkedIn import can set candidate_profiles.photo_url without
 * users.avatar_url — header avatar divergence (found reviewing #1608).
 *
 * User journey: a candidate imports their LinkedIn profile. The import
 * fills candidate_profiles.photo_url with the LinkedIn picture, but the
 * header reads users.avatar_url (served by GET /auth/me from the auth
 * context), so the header kept showing the default avatar — the same
 * symptom class as #1608, via a different writer.
 *
 * Expected (PRD prd-job-board-and-profile.md FR-M2, one avatar value):
 * after the import, when the candidate has a profile photo and no avatar
 * yet, users.avatar_url holds the SAME value as candidate_profiles.photo_url.
 * Merge semantics are fill-gaps only (mergeLinkedInProfile never overwrites
 * manually-entered data), so an existing users.avatar_url is never clobbered.
 *
 * No live Postgres in this environment: the DB layer is the repo's standard
 * mocked lib/db (server/test/setup.js) extended here with an in-memory
 * interpreter for exactly the statements the import path issues, applying
 * real fill-gaps (COALESCE) semantics. The LinkedIn API boundary is the
 * global fetch mock; the token-decrypt boundary is mocked.
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass (same pattern as candidate-autosend.test.js) ─────────────
jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});
	return { ...actual, authMiddleware };
});

// ─── Token decrypt boundary ────────────────────────────────────────────────
jest.mock('../../../lib/crypto-utils', () => {
	const actual = jest.requireActual('../../../lib/crypto-utils');
	return { ...actual, decrypt: jest.fn(() => 'test-linkedin-token') };
});

// ─── Side-effect boundaries (non-blocking in production) ───────────────────
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));

// ─── In-memory import-path store (extends the global mocked lib/db) ───────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const PICTURE_URL = 'https://media.licdn.com/dms/image/test-profile-photo.jpg';
const MANUAL_AVATAR_URL = 'https://storage.example/photos/manual-upload.jpg';
const EXISTING_PHOTO_URL = 'https://storage.example/photos/existing-profile.jpg';

const store = {
	users: new Map(), // id -> { id, name, title, avatar_url, linkedin_data }
	profiles: new Map(), // user_id -> { user_id, headline, bio, photo_url }
};

let linkedinPicture = PICTURE_URL;

function resetStore() {
	store.users.clear();
	store.profiles.clear();
	linkedinPicture = PICTURE_URL;

	store.users.set(1, { id: 1, name: '', title: null, avatar_url: null, linkedin_data: null });
	store.users.set(2, {
		id: 2,
		name: 'Manual Avatar User',
		title: null,
		avatar_url: MANUAL_AVATAR_URL,
		linkedin_data: null,
	});
	store.users.set(3, { id: 3, name: 'Existing Photo User', title: null, avatar_url: null, linkedin_data: null });
	store.profiles.set(3, {
		user_id: 3,
		headline: 'Existing headline',
		bio: null,
		photo_url: EXISTING_PHOTO_URL,
	});
	store.users.set(4, { id: 4, name: 'No Picture User', title: null, avatar_url: null, linkedin_data: null });

	global.__testUsers = {};
	for (const [id, u] of store.users) {
		global.__testUsers[id] = { id, name: u.name, email: `user${id}@test.com`, role: 'candidate' };
	}
}

function isEmpty(v) {
	return v === null || v === undefined || String(v).trim() === '';
}

function installDbInterpreter() {
	db.query.mockImplementation(async (sql, params = []) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// Route step 1: LinkedIn OAuth connection lookup
		if (normalized.includes('from oauth_connections')) {
			return {
				rows: [
					{
						access_token: 'encrypted-token',
						refresh_token: null,
						provider_user_id: 'li-user',
						profile_data: null,
					},
				],
				rowCount: 1,
			};
		}

		// Merge step 1: UPDATE users SET name = COALESCE(NULLIF(TRIM(name), ''), $2),
		// title = COALESCE(...), linkedin_data = $4 ... RETURNING name, title
		if (normalized.startsWith('update users') && normalized.includes('linkedin_data')) {
			const user = store.users.get(params[0]);
			if (!user) return { rows: [], rowCount: 0 };
			if (isEmpty(user.name)) user.name = params[1];
			if (isEmpty(user.title)) user.title = params[2];
			user.linkedin_data = params[3];
			return { rows: [{ name: user.name, title: user.title }], rowCount: 1 };
		}

		// Merge step 2: INSERT INTO candidate_profiles (user_id, headline, bio, photo_url)
		// ... ON CONFLICT DO UPDATE SET headline/bio/photo_url = fill-gaps COALESCE
		if (
			normalized.includes('insert into candidate_profiles') &&
			normalized.includes('headline, bio, photo_url')
		) {
			const [userId, headline, bio, picture] = params;
			const existing = store.profiles.get(userId) || {
				user_id: userId,
				headline: null,
				bio: null,
				photo_url: null,
			};
			if (isEmpty(existing.headline)) existing.headline = headline;
			if (isEmpty(existing.bio)) existing.bio = bio;
			if (existing.photo_url === null || existing.photo_url === undefined) {
				existing.photo_url = picture;
			}
			store.profiles.set(userId, existing);
			return { rows: [], rowCount: 1 };
		}

		// #1638 fix statement: UPDATE users u SET avatar_url = cp.photo_url ...
		// FROM candidate_profiles cp ... avatar empty AND photo present (fill-gaps)
		if (normalized.startsWith('update users') && normalized.includes('avatar_url = cp.photo_url')) {
			const user = store.users.get(params[0]);
			const profile = store.profiles.get(params[0]);
			if (user && profile && isEmpty(user.avatar_url) && !isEmpty(profile.photo_url)) {
				user.avatar_url = profile.photo_url;
				return { rows: [], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}

		// #1608 pattern, if used instead: UPDATE users SET avatar_url = $1 WHERE id = $2
		if (normalized.startsWith('update users set avatar_url = $')) {
			const user = store.users.get(params[1]);
			if (user) user.avatar_url = params[0];
			return { rows: [], rowCount: user ? 1 : 0 };
		}

		return baseQueryImpl(sql, params);
	});
}

// ─── LinkedIn API boundary (global fetch) ─────────────────────────────────
function installFetchMock() {
	global.fetch = jest.fn(async (url) => {
		if (String(url).includes('/v2/userinfo')) {
			const userinfo = {
				sub: 'li-user',
				name: 'Imported Candidate',
				given_name: 'Imported',
				family_name: 'Candidate',
				email: 'imported@test.com',
			};
			if (linkedinPicture) userinfo.picture = linkedinPicture;
			return { ok: true, status: 200, json: async () => userinfo, text: async () => '' };
		}
		// v2/me, positions, educations, skills — unavailable without partner scope
		return { ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' };
	});
}

const candidateRouter = require('../../../routes/candidate');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/candidate', candidateRouter);
	return app;
}

describe('POST /candidate/linkedin/import — one avatar value (#1638)', () => {
	beforeEach(() => {
		resetStore();
		installDbInterpreter();
		installFetchMock();
	});

	afterEach(() => {
		db.query.mockImplementation(baseQueryImpl);
	});

	it('fills users.avatar_url with the imported picture when the import fills photo_url — the header shows the imported picture', async () => {
		const res = await request(buildApp())
			.post('/candidate/linkedin/import')
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		// The merge filled the profile photo (existing behaviour)…
		expect(store.profiles.get(1)?.photo_url).toBe(PICTURE_URL);
		// …and THE #1638 ASSERTION: the header's source column holds the same value.
		expect(store.users.get(1)?.avatar_url).toBe(PICTURE_URL);
	});

	it('never overwrites an existing users.avatar_url (fill-gaps merge semantics — a manually uploaded avatar survives an import)', async () => {
		const res = await request(buildApp())
			.post('/candidate/linkedin/import')
			.set('x-test-user-id', '2');

		expect(res.status).toBe(200);
		expect(store.profiles.get(2)?.photo_url).toBe(PICTURE_URL);
		expect(store.users.get(2)?.avatar_url).toBe(MANUAL_AVATAR_URL);
	});

	it('converges on the existing profile photo: photo_url is not overwritten, and the empty avatar fills with that same value', async () => {
		const res = await request(buildApp())
			.post('/candidate/linkedin/import')
			.set('x-test-user-id', '3');

		expect(res.status).toBe(200);
		expect(store.profiles.get(3)?.photo_url).toBe(EXISTING_PHOTO_URL);
		expect(store.users.get(3)?.avatar_url).toBe(EXISTING_PHOTO_URL);
	});

	it('writes no avatar when neither the import nor the profile has a picture (no fabricated avatar)', async () => {
		linkedinPicture = null;

		const res = await request(buildApp())
			.post('/candidate/linkedin/import')
			.set('x-test-user-id', '4');

		expect(res.status).toBe(200);
		expect(store.profiles.get(4)?.photo_url ?? null).toBeNull();
		expect(store.users.get(4)?.avatar_url).toBeNull();
	});
});
