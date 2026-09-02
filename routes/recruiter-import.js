// Issue #141 — Bulk candidate and job import
const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware, requireApprovedRecruiter, requireNotSuspended } = require('../lib/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ponytail: native CSV parser — split on newlines then commas. MVP only, no quoted commas.
function parseSimpleCsv(buffer) {
	const text = buffer.toString('utf-8').trim();
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length === 0) return { headers: [], rows: [] };

	const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
	const rows = lines.slice(1).map((line) => {
		const values = line.split(',');
		const row = {};
		headers.forEach((h, i) => {
			row[h] = (values[i] || '').trim();
		});
		return row;
	});
	return { headers, rows };
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

// ponytail: minimal helper, duplicated from recruiter.js to avoid coupling
async function ensureCompany(req, res, next) {
	if (!req.user.company_id) {
		return res.status(403).json({ error: 'No company associated with this account' });
	}
	next();
}

// POST /api/recruiter/import
router.post(
	'/import',
	authMiddleware,
	requireNotSuspended,
	requireApprovedRecruiter,
	ensureCompany,
	requirePermission('candidates:manage'),
	upload.single('file'),
	async (req, res) => {
		const { type } = req.body;

		if (!type || !['candidates', 'jobs'].includes(type)) {
			return res.status(400).json({ error: "type must be 'candidates' or 'jobs'" });
		}
		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}
		if (req.file.mimetype !== 'text/csv' && !req.file.originalname.endsWith('.csv')) {
			return res.status(400).json({ error: 'File must be a CSV' });
		}

		// Parse CSV
		let parsed;
		try {
			parsed = parseSimpleCsv(req.file.buffer);
		} catch (err) {
			return res.status(400).json({ error: 'Failed to parse CSV', detail: err.message });
		}

		if (parsed.rows.length === 0) {
			return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
		}

		// Create import job record
		const importResult = await pool.query(
			`INSERT INTO import_jobs (filename, type, status, row_count, created_by)
       VALUES ($1, $2, 'processing', $3, $4)
       RETURNING id`,
			[req.file.originalname, type, parsed.rows.length, req.user.id],
		);
		const importId = importResult.rows[0].id;

		const errors = [];
		const warnings = [];
		let processedCount = 0;

		// ─── Process in a transaction ────────────────────────────────────
		const client = await pool.connect();
		try {
			await client.query('BEGIN');

			if (type === 'candidates') {
				// Validate headers
				if (!parsed.headers.includes('name') || !parsed.headers.includes('email')) {
					throw new Error("CSV must contain 'name' and 'email' columns");
				}

				for (let i = 0; i < parsed.rows.length; i++) {
					const row = parsed.rows[i];
					const rowNum = i + 2; // 1-based, skipping header

					if (!row.name) {
						errors.push({ row: rowNum, message: 'Missing required field: name' });
						continue;
					}
					if (!row.email) {
						errors.push({ row: rowNum, message: 'Missing required field: email' });
						continue;
					}
					if (!isValidEmail(row.email)) {
						errors.push({ row: rowNum, message: `Invalid email: ${row.email}` });
						continue;
					}

					// Duplicate detection: existing email in users table
					const dupCheck = await client.query('SELECT id FROM users WHERE email = $1', [
						row.email.toLowerCase(),
					]);
					if (dupCheck.rows.length > 0) {
						warnings.push({
							row: rowNum,
							message: `Duplicate email skipped: ${row.email}`,
						});
						continue;
					}

					// Insert candidate into users table
					await client.query(
						`INSERT INTO users (email, name, role, company_name, password_hash, created_at, updated_at)
             VALUES ($1, $2, 'candidate', $3, $4, NOW(), NOW())`,
						[
							row.email.toLowerCase(),
							row.name,
							req.user.company_name || null,
							crypto.randomBytes(32).toString('hex'), // ponytail: random placeholder password
						],
					);

					processedCount++;
				}
			} else if (type === 'jobs') {
				// Validate headers
				if (
					!parsed.headers.includes('title') ||
					!parsed.headers.includes('company') ||
					!parsed.headers.includes('location')
				) {
					throw new Error("CSV must contain 'title', 'company', and 'location' columns");
				}

				for (let i = 0; i < parsed.rows.length; i++) {
					const row = parsed.rows[i];
					const rowNum = i + 2;

					if (!row.title) {
						errors.push({ row: rowNum, message: 'Missing required field: title' });
						continue;
					}
					if (!row.company) {
						errors.push({ row: rowNum, message: 'Missing required field: company' });
						continue;
					}
					if (!row.location) {
						errors.push({ row: rowNum, message: 'Missing required field: location' });
						continue;
					}

					// Duplicate detection: existing title+company combo
					const dupCheck = await client.query(
						`SELECT id FROM jobs
             WHERE title = $1 AND company = $2
               AND (company_id = $3 OR user_id = $4)`,
						[row.title, row.company, req.user.company_id, req.user.id],
					);
					if (dupCheck.rows.length > 0) {
						warnings.push({
							row: rowNum,
							message: `Duplicate job skipped: ${row.title} @ ${row.company}`,
						});
						continue;
					}

					// Insert job
					await client.query(
						`INSERT INTO jobs (user_id, company_id, title, company, description, requirements, location, salary_range, job_type, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW())`,
						[
							req.user.id,
							req.user.company_id,
							row.title,
							row.company,
							row.description || null,
							row.requirements || null,
							row.location,
							row.salary_range || null,
							row.job_type || 'full-time',
						],
					);

					processedCount++;
				}
			}

			await client.query('COMMIT');

			// Update import_jobs to completed
			await pool.query(
				`UPDATE import_jobs
           SET status = 'completed',
               processed_count = $1,
               error_count = $2,
               error_summary = $3,
               completed_at = NOW()
         WHERE id = $4`,
				[processedCount, errors.length, JSON.stringify(errors), importId],
			);

			res.json({
				importId,
				status: 'completed',
				rowCount: parsed.rows.length,
				processedCount,
				errorCount: errors.length,
				warningCount: warnings.length,
				errors,
				warnings,
			});
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});

			// Mark import job as failed
			await pool.query(
				`UPDATE import_jobs
           SET status = 'failed',
               error_summary = $1,
               completed_at = NOW()
         WHERE id = $2`,
				[JSON.stringify([{ message: err.message }]), importId],
			);

			console.error('[import] Failed:', err);
			res.status(500).json({
				importId,
				status: 'failed',
				rowCount: parsed.rows.length,
				errors: [{ message: err.message }],
			});
		} finally {
			client.release();
		}
	},
);

// GET /api/recruiter/import/:id — get import job status
router.get(
	'/import/:id',
	authMiddleware,
	requireApprovedRecruiter,
	ensureCompany,
	requirePermission('candidates:read'),
	async (req, res) => {
		try {
			const result = await pool.query(
				`SELECT * FROM import_jobs WHERE id = $1 AND created_by = $2`,
				[req.params.id, req.user.id],
			);
			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Import job not found' });
			}
			res.json({ success: true, import: result.rows[0] });
		} catch (err) {
			console.error('Get import job error:', err);
			res.status(500).json({ error: 'Failed to fetch import job' });
		}
	},
);

// GET /api/recruiter/imports — list import jobs for user
router.get(
	'/imports',
	authMiddleware,
	requireApprovedRecruiter,
	ensureCompany,
	requirePermission('candidates:read'),
	async (req, res) => {
		try {
			const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
			const offset = parseInt(req.query.offset, 10) || 0;
			const result = await pool.query(
				`SELECT * FROM import_jobs WHERE created_by = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
				[req.user.id, limit, offset],
			);
			const countResult = await pool.query(
				`SELECT COUNT(*) as total FROM import_jobs WHERE created_by = $1`,
				[req.user.id],
			);
			res.json({
				success: true,
				imports: result.rows,
				total: parseInt(countResult.rows[0].total, 10),
			});
		} catch (err) {
			console.error('List imports error:', err);
			res.status(500).json({ error: 'Failed to list import jobs' });
		}
	},
);

module.exports = router;
