// Candidate Profile API Routes
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { authMiddleware, requireRole } = require('../lib/auth');
const pool = require('../lib/db');
const {
	parseResume,
	generateSkillAssessment,
	evaluateSkillAssessment,
	generateJobMatchScore,
	generateInterviewCoaching,
} = require('../lib/polsia-ai');

const omniscoreService = require('../services/omniscore');
const { decrypt } = require('../lib/crypto-utils');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const emailService = require('../lib/email-service');
const { checkFeatureAccess, incrementUsage } = require('../lib/subscription');
const calendarService = require('../server/services/calendar-service');

let matchingEngine;
try {
	matchingEngine = require('../services/matching-engine');
} catch (_e) {
	matchingEngine = null;
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function badRequest(message) {
	const err = new Error(message);
	err.statusCode = 400;
	return err;
}

function normalizeTextField(value, maxLength, fieldName) {
	if (value === undefined || value === null) return value;
	const normalized = String(value)
		.replace(/<[^>]*>/g, '')
		.replace(/\u0000/g, '')
		.trim();
	if (!normalized) return null;
	if (normalized.length > maxLength) {
		throw badRequest(`${fieldName} must be ${maxLength} characters or fewer`);
	}
	return normalized;
}

function normalizeUrlField(value, fieldName) {
	if (value === undefined || value === null) return value;
	const normalized = String(value).trim();
	if (!normalized) return null;
	if (normalized.length > 2048) {
		throw badRequest(`${fieldName} is too long`);
	}

	let parsed;
	try {
		parsed = new URL(normalized);
	} catch {
		throw badRequest(`${fieldName} must be a valid URL`);
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw badRequest(`${fieldName} must use http or https`);
	}

	return parsed.toString();
}

function normalizePositiveInteger(value, fieldName, maxValue = Number.MAX_SAFE_INTEGER) {
	if (value === undefined || value === null || value === '') return value;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
		throw badRequest(`${fieldName} must be a non-negative integer`);
	}
	return parsed;
}

// Helper: trigger async profile re-embedding + OmniScore recalc on profile changes
function triggerProfileUpdate(userId, changeType) {
	setImmediate(async () => {
		try {
			if (matchingEngine?.updateCandidateEmbedding) {
				await matchingEngine.updateCandidateEmbedding(userId);
				console.log(`[Profile] Re-embedded profile for user ${userId} (${changeType})`);
			}
			await omniscoreService.onProfileUpdate(userId, changeType);
		} catch (err) {
			console.error(`[Profile] Async update failed for user ${userId}:`, err.message);
		}
	});
}

// Helper function to extract text from various file formats
async function extractTextFromFile(buffer, mimetype) {
	try {
		// Handle PDF files
		if (mimetype === 'application/pdf' || buffer.toString('utf-8', 0, 4) === '%PDF') {
			const pdfData = await pdfParse(buffer);
			return pdfData.text;
		}

		// Handle DOCX files (application/vnd.openxmlformats-officedocument.wordprocessingml.document)
		if (
			mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
			buffer.toString('utf-8', 0, 2) === 'PK'
		) {
			const result = await mammoth.extractRawText({ buffer });
			return result.value;
		}

		// Handle plain text files (fallback)
		const text = buffer.toString('utf-8');
		if (text.length > 0 && /[a-zA-Z]{3,}/.test(text.substring(0, 500))) {
			return text;
		}

		throw new Error('Unsupported file format or unable to extract text');
	} catch (error) {
		console.error('Text extraction error:', error.message);
		throw error;
	}
}

// ============= PROFILE MANAGEMENT =============

// Get candidate profile
router.get('/profile', authMiddleware, async (req, res) => {
	try {
		const profile = await pool.query(
			`
      SELECT cp.*, u.name, u.email, u.avatar_url, os.total_score as omni_score
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE u.id = $1
    `,
			[req.user.id],
		);

		const experience = await pool.query(
			'SELECT * FROM work_experience WHERE user_id = $1 ORDER BY order_index, start_date DESC',
			[req.user.id],
		);

		const education = await pool.query(
			'SELECT * FROM education WHERE user_id = $1 ORDER BY order_index, start_date DESC',
			[req.user.id],
		);

		const skills = await pool.query(
			'SELECT * FROM candidate_skills WHERE user_id = $1 ORDER BY level DESC, skill_name',
			[req.user.id],
		);

		const projects = await pool.query(
			'SELECT * FROM portfolio_projects WHERE user_id = $1 ORDER BY order_index, start_date DESC',
			[req.user.id],
		);

		res.json({
			success: true,
			profile: profile.rows[0] || {},
			experience: experience.rows,
			education: education.rows,
			skills: skills.rows,
			projects: projects.rows,
		});
	} catch (err) {
		console.error('Get profile error:', err);
		res.status(500).json({ error: 'Failed to get profile' });
	}
});

// Update basic profile info
router.put('/profile', authMiddleware, async (req, res) => {
	try {
		const {
			headline,
			bio,
			location,
			phone,
			linkedin_url,
			github_url,
			portfolio_url,
			availability,
			salary_min,
			salary_max,
			preferred_job_types,
			preferred_locations,
			remote_preference,
			years_experience,
		} = req.body;

		const sanitizedHeadline = normalizeTextField(headline, 120, 'Headline');
		const sanitizedBio = normalizeTextField(bio, 2000, 'Bio');
		const sanitizedLocation = normalizeTextField(location, 120, 'Location');
		const sanitizedPhone = normalizeTextField(phone, 40, 'Phone');
		const sanitizedLinkedinUrl = normalizeUrlField(linkedin_url, 'LinkedIn URL');
		const sanitizedGithubUrl = normalizeUrlField(github_url, 'GitHub URL');
		const sanitizedPortfolioUrl = normalizeUrlField(portfolio_url, 'Portfolio URL');
		const sanitizedAvailability = normalizeTextField(availability, 60, 'Availability');
		const sanitizedSalaryMin = normalizePositiveInteger(salary_min, 'salary_min');
		const sanitizedSalaryMax = normalizePositiveInteger(salary_max, 'salary_max');
		const sanitizedYearsExperience = normalizePositiveInteger(
			years_experience,
			'years_experience',
			80,
		);

		if (
			sanitizedSalaryMin !== undefined &&
			sanitizedSalaryMax !== undefined &&
			sanitizedSalaryMin !== null &&
			sanitizedSalaryMax !== null &&
			sanitizedSalaryMin > sanitizedSalaryMax
		) {
			return res.status(400).json({ error: 'Minimum salary cannot exceed maximum salary' });
		}

		// Check if profile exists
		const existing = await pool.query('SELECT id FROM candidate_profiles WHERE user_id = $1', [
			req.user.id,
		]);

		let result;
		if (existing.rows.length > 0) {
			result = await pool.query(
				`
        UPDATE candidate_profiles SET
          headline = COALESCE($2, headline),
          bio = COALESCE($3, bio),
          location = COALESCE($4, location),
          phone = COALESCE($5, phone),
          linkedin_url = COALESCE($6, linkedin_url),
          github_url = COALESCE($7, github_url),
          portfolio_url = COALESCE($8, portfolio_url),
          availability = COALESCE($9, availability),
          salary_min = COALESCE($10, salary_min),
          salary_max = COALESCE($11, salary_max),
          preferred_job_types = COALESCE($12, preferred_job_types),
          preferred_locations = COALESCE($13, preferred_locations),
          remote_preference = COALESCE($14, remote_preference),
          years_experience = COALESCE($15, years_experience),
          updated_at = NOW()
        WHERE user_id = $1
        RETURNING *
      `,
				[
					req.user.id,
					sanitizedHeadline,
					sanitizedBio,
					sanitizedLocation,
					sanitizedPhone,
					sanitizedLinkedinUrl,
					sanitizedGithubUrl,
					sanitizedPortfolioUrl,
					sanitizedAvailability,
					sanitizedSalaryMin,
					sanitizedSalaryMax,
					JSON.stringify(preferred_job_types),
					JSON.stringify(preferred_locations),
					remote_preference,
					sanitizedYearsExperience,
				],
			);
		} else {
			result = await pool.query(
				`
        INSERT INTO candidate_profiles (
          user_id, headline, bio, location, phone,
          linkedin_url, github_url, portfolio_url,
          availability, salary_min, salary_max,
          preferred_job_types, preferred_locations,
          remote_preference, years_experience
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `,
				[
					req.user.id,
					sanitizedHeadline,
					sanitizedBio,
					sanitizedLocation,
					sanitizedPhone,
					sanitizedLinkedinUrl,
					sanitizedGithubUrl,
					sanitizedPortfolioUrl,
					sanitizedAvailability,
					sanitizedSalaryMin,
					sanitizedSalaryMax,
					JSON.stringify(preferred_job_types || ['full-time']),
					JSON.stringify(preferred_locations || []),
					remote_preference || 'hybrid',
					sanitizedYearsExperience || 0,
				],
			);
		}

		// Also update user name if provided
		if (req.body.name) {
			const sanitizedName = normalizeTextField(req.body.name, 120, 'Name');
			await pool.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [
				sanitizedName,
				req.user.id,
			]);
		}

		res.json({ success: true, profile: result.rows[0] });
	} catch (err) {
		if (err.statusCode === 400) {
			return res
				.status(400)
				.json({ error: 'Invalid job data. Please check your input and try again.' });
		}
		console.error('Update profile error:', err);
		res.status(500).json({ error: 'Failed to update profile' });
	}
});

// Upload profile photo
router.post('/profile/photo', authMiddleware, upload.single('photo'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}

		// Upload to R2 via Polsia proxy using native FormData
		const formData = new FormData();
		formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

		const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
			},
			body: formData,
		});

		const uploadResult = await uploadRes.json();
		if (!uploadResult.success) {
			throw new Error(uploadResult.error?.message || 'Upload failed');
		}

		// Update profile with photo URL
		await pool.query(
			`
      INSERT INTO candidate_profiles (user_id, photo_url)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET photo_url = $2, updated_at = NOW()
    `,
			[req.user.id, uploadResult.file.url],
		);

		// Also update user avatar
		await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [
			uploadResult.file.url,
			req.user.id,
		]);

		res.json({ success: true, photo_url: uploadResult.file.url });
	} catch (err) {
		console.error('Photo upload error:', err);
		res.status(500).json({ error: 'Failed to upload photo' });
	}
});

// Upload profile resume (simple — stores file, no AI parsing or auto-apply)
router.post('/profile/resume', authMiddleware, upload.single('resume'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}

		// Validate file type: PDF, DOC, DOCX only
		const allowedTypes = [
			'application/pdf',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		];
		if (!allowedTypes.includes(req.file.mimetype)) {
			return res.status(400).json({ error: 'Invalid file type. Only PDF, DOC, and DOCX are allowed.' });
		}

		// Upload to R2 via Polsia proxy using native FormData
		const formData = new FormData();
		formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

		const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
			},
			body: formData,
		});

		const uploadResult = await uploadRes.json();
		if (!uploadResult.success) {
			throw new Error(uploadResult.error?.message || 'Upload failed');
		}

		await pool.query(
			`
			INSERT INTO parsed_resumes (user_id, original_filename, file_url, parsing_status)
			VALUES ($1, $2, $3, 'processing')
			RETURNING id
			`,
			[req.user.id, req.file.originalname, uploadResult.file.url],
		);

		// Update profile with resume URL
		await pool.query(
			`
			INSERT INTO candidate_profiles (user_id, resume_url)
			VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET resume_url = $2, updated_at = NOW()
			`,
			[req.user.id, uploadResult.file.url],
		);

		res.json({ success: true, resume_url: uploadResult.file.url });
	} catch (err) {
		console.error('Profile resume upload error:', err);
		res.status(500).json({ error: 'Failed to upload resume' });
	}
});

// Remove profile resume
router.delete('/profile/resume', authMiddleware, async (req, res) => {
	try {
		await pool.query(
			`
			UPDATE candidate_profiles
			SET resume_url = NULL, updated_at = NOW()
			WHERE user_id = $1
			`,
			[req.user.id],
		);
		res.json({ success: true });
	} catch (err) {
		console.error('Profile resume delete error:', err);
		res.status(500).json({ error: 'Failed to remove resume' });
	}
});

// ============= RESUME PARSING =============

// Upload and parse resume
router.post('/resume/upload', authMiddleware, upload.single('resume'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}

		// Upload to R2 via Polsia proxy using native FormData
		const formData = new FormData();
		formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

		const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
			},
			body: formData,
		});

		const uploadResult = await uploadRes.json();
		if (!uploadResult.success) {
			throw new Error(uploadResult.error?.message || 'Upload failed');
		}

		const resumeRecord = await pool.query(
			`
      INSERT INTO parsed_resumes (user_id, original_filename, file_url, parsing_status)
      VALUES ($1, $2, $3, 'processing')
      RETURNING id
    `,
			[req.user.id, req.file.originalname, uploadResult.file.url],
		);

		// Update profile with resume URL
		await pool.query(
			`
      INSERT INTO candidate_profiles (user_id, resume_url)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET resume_url = $2, updated_at = NOW()
    `,
			[req.user.id, uploadResult.file.url],
		);

		// Extract text from the resume (supports PDF, DOCX, and plain text)
		let parsedData = null;
		try {
			// Extract text from the file buffer
			const resumeText = await extractTextFromFile(req.file.buffer, req.file.mimetype);

			if (resumeText && resumeText.trim().length > 50) {
				// Get user's subscription for tracking
				const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
					req.user.id,
				]);
				const subscriptionId = user.rows[0]?.stripe_subscription_id;

				// Parse with AI, with a 30-second timeout
				const parsePromise = parseResume(resumeText.substring(0, 15000), { subscriptionId });
				const timeoutPromise = new Promise((_, reject) =>
					setTimeout(() => reject(new Error('AI parsing timeout')), 30000),
				);

				parsedData = await Promise.race([parsePromise, timeoutPromise]);

				// Update the record with parsed data
				await pool.query(
					`
          UPDATE parsed_resumes
          SET parsed_data = $1, parsing_status = 'completed', parsed_at = NOW()
          WHERE id = $2
        `,
					[JSON.stringify(parsedData), resumeRecord.rows[0].id],
				);

				console.log(`Successfully parsed ${req.file.mimetype} resume for user ${req.user.id}`);

				// ====== AUTO-APPLY parsed data to profile ======
				try {
					const applySummary = { profile: false, experience: 0, education: 0, skills: 0 };

					// 1. Apply contact/profile info
					if (parsedData.contact) {
						await pool.query(
							`
              INSERT INTO candidate_profiles (user_id, headline, bio, location, phone, linkedin_url, github_url, portfolio_url, years_experience)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (user_id) DO UPDATE SET
                headline = COALESCE(NULLIF($2, ''), candidate_profiles.headline),
                bio = COALESCE(NULLIF($3, ''), candidate_profiles.bio),
                location = COALESCE(NULLIF($4, ''), candidate_profiles.location),
                phone = COALESCE(NULLIF($5, ''), candidate_profiles.phone),
                linkedin_url = COALESCE(NULLIF($6, ''), candidate_profiles.linkedin_url),
                github_url = COALESCE(NULLIF($7, ''), candidate_profiles.github_url),
                portfolio_url = COALESCE(NULLIF($8, ''), candidate_profiles.portfolio_url),
                years_experience = COALESCE($9, candidate_profiles.years_experience),
                updated_at = NOW()
              RETURNING *
            `,
							[
								req.user.id,
								normalizeTextField(
									parsedData.contact.headline || parsedData.contact.title,
									120,
									'Headline',
								),
								normalizeTextField(parsedData.contact.bio, 2000, 'Bio'),
								normalizeTextField(parsedData.contact.location, 120, 'Location'),
								normalizeTextField(parsedData.contact.phone, 40, 'Phone'),
								normalizeUrlField(
									parsedData.contact.linkedin_url || parsedData.contact.linkedin,
									'LinkedIn URL',
								),
								normalizeUrlField(
									parsedData.contact.github_url || parsedData.contact.github,
									'GitHub URL',
								),
								normalizeUrlField(
									parsedData.contact.portfolio_url || parsedData.contact.website,
									'Portfolio URL',
								),
								normalizePositiveInteger(
									parsedData.contact.years_experience,
									'years_experience',
									80,
								),
							],
						);
						applySummary.profile = true;

						// Update user name/email if empty
						if (parsedData.contact.name) {
							await pool.query(
								`UPDATE users SET name = $1 WHERE id = $2 AND (name IS NULL OR name = '')`,
								[parsedData.contact.name, req.user.id],
							);
						}
					}

					// 2. Apply work experience (with dedup: skip if same company+title exists)
					if (parsedData.experience && Array.isArray(parsedData.experience)) {
						for (let i = 0; i < parsedData.experience.length; i++) {
							const exp = parsedData.experience[i];
							if (!exp.company || !exp.title) continue;

							// Check for duplicate
							const existing = await pool.query(
								`SELECT id FROM work_experience WHERE user_id = $1 AND LOWER(company_name) = LOWER($2) AND LOWER(title) = LOWER($3)`,
								[req.user.id, exp.company, exp.title],
							);
							if (existing.rows.length > 0) continue;

							await pool.query(
								`
                INSERT INTO work_experience (user_id, company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used, order_index)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              `,
								[
									req.user.id,
									exp.company,
									exp.title,
									exp.location || null,
									exp.start_date
										? new Date(
												exp.start_date.length === 4
													? `${exp.start_date}-01-01`
													: `${exp.start_date}-01`,
											)
										: null,
									exp.end_date && exp.end_date !== 'Present'
										? new Date(
												exp.end_date.length === 4 ? `${exp.end_date}-01-01` : `${exp.end_date}-01`,
											)
										: null,
									exp.is_current || exp.end_date === 'Present',
									exp.description || null,
									JSON.stringify(exp.achievements || []),
									JSON.stringify(exp.skills_used || []),
									i,
								],
							);
							applySummary.experience++;
						}
					}

					// 3. Apply education (with dedup: skip if same institution+degree exists)
					if (parsedData.education && Array.isArray(parsedData.education)) {
						for (let i = 0; i < parsedData.education.length; i++) {
							const edu = parsedData.education[i];
							if (!edu.institution) continue;

							// Check for duplicate
							const existing = await pool.query(
								`SELECT id FROM education WHERE user_id = $1 AND LOWER(institution) = LOWER($2) AND LOWER(COALESCE(degree, '')) = LOWER(COALESCE($3, ''))`,
								[req.user.id, edu.institution, edu.degree || ''],
							);
							if (existing.rows.length > 0) continue;

							await pool.query(
								`
                INSERT INTO education (user_id, institution, degree, field_of_study, start_date, end_date, gpa, achievements, order_index)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `,
								[
									req.user.id,
									edu.institution,
									edu.degree || null,
									edu.field || null,
									edu.start_date ? new Date(`${edu.start_date}-01-01`) : null,
									edu.end_date && edu.end_date !== 'Present'
										? new Date(`${edu.end_date}-01-01`)
										: null,
									edu.gpa || null,
									JSON.stringify(edu.achievements || []),
									i,
								],
							);
							applySummary.education++;
						}
					}

					// 4. Apply skills (upsert — won't duplicate due to UNIQUE constraint)
					if (parsedData.skills && Array.isArray(parsedData.skills)) {
						for (const skill of parsedData.skills) {
							if (!skill.name) continue;
							try {
								// Coerce string level names to integers
								let skillLevel = skill.level || 3;
								if (typeof skillLevel === 'string') {
									const lvlMap = { beginner: 1, basic: 2, intermediate: 3, advanced: 4, expert: 5 };
									skillLevel = lvlMap[skillLevel.toLowerCase()] || parseInt(skillLevel, 10) || 3;
								}
								skillLevel = Math.max(1, Math.min(5, parseInt(skillLevel, 10) || 3));
								await pool.query(
									`
                  INSERT INTO candidate_skills (user_id, skill_name, category, level)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT (user_id, skill_name) DO UPDATE SET
                    category = COALESCE(NULLIF($3, ''), candidate_skills.category),
                    level = GREATEST(candidate_skills.level, $4)
                `,
									[req.user.id, skill.name, skill.category || 'technical', skillLevel],
								);
								applySummary.skills++;
							} catch (skillErr) {
								console.error('Skip skill insert:', skillErr.message);
							}
						}
					}

					parsedData._applySummary = applySummary;
					console.log(`Auto-applied resume data for user ${req.user.id}:`, applySummary);
				} catch (applyErr) {
					console.error('Auto-apply resume data failed (non-fatal):', applyErr.message);
				}
			} else {
				console.log('Extracted text too short - marking as uploaded');
				await pool.query(
					`
          UPDATE parsed_resumes
          SET parsing_status = 'uploaded', parsed_at = NOW()
          WHERE id = $1
        `,
					[resumeRecord.rows[0].id],
				);
			}
		} catch (parseErr) {
			console.error('Resume parsing failed (non-fatal):', parseErr.message);
			await pool.query(
				`
        UPDATE parsed_resumes
        SET parsing_status = 'failed', parsed_at = NOW()
        WHERE id = $1
      `,
				[resumeRecord.rows[0].id],
			);
		}

		res.json({
			success: true,
			resume_url: uploadResult.file.url,
			parsed_data: parsedData,
			resume_id: resumeRecord.rows[0].id,
		});
	} catch (err) {
		console.error('Resume upload error:', err);
		res.status(500).json({ error: 'Failed to upload resume' });
	}
});

// Apply parsed resume data to profile
router.post('/resume/apply', authMiddleware, async (req, res) => {
	try {
		const { parsed_data, apply_sections } = req.body;

		if (!parsed_data) {
			return res.status(400).json({ error: 'No parsed data provided' });
		}

		const sections = apply_sections || ['profile', 'experience', 'education', 'skills'];

		// Apply profile info
		if (sections.includes('profile') && parsed_data.contact) {
			await pool.query(
				`
        INSERT INTO candidate_profiles (user_id, headline, bio, location, linkedin_url, github_url, portfolio_url, years_experience)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
          headline = COALESCE($2, candidate_profiles.headline),
          bio = COALESCE($3, candidate_profiles.bio),
          location = COALESCE($4, candidate_profiles.location),
          linkedin_url = COALESCE($5, candidate_profiles.linkedin_url),
          github_url = COALESCE($6, candidate_profiles.github_url),
          portfolio_url = COALESCE($7, candidate_profiles.portfolio_url),
          years_experience = COALESCE($8, candidate_profiles.years_experience),
          updated_at = NOW()
      `,
				[
					req.user.id,
					parsed_data.headline,
					parsed_data.bio,
					parsed_data.contact.location,
					parsed_data.contact.linkedin,
					parsed_data.contact.github,
					parsed_data.contact.portfolio,
					parsed_data.years_experience,
				],
			);

			// Update user name if found
			if (parsed_data.contact.name) {
				await pool.query(
					"UPDATE users SET name = $1 WHERE id = $2 AND (name IS NULL OR name = '')",
					[parsed_data.contact.name, req.user.id],
				);
			}
		}

		// Apply work experience
		if (sections.includes('experience') && parsed_data.experience) {
			for (let i = 0; i < parsed_data.experience.length; i++) {
				const exp = parsed_data.experience[i];
				// Skip entries missing required NOT NULL fields (company_name, title)
				if (!exp.company || !String(exp.company).trim() || !exp.title || !String(exp.title).trim())
					continue;
				await pool.query(
					`
          INSERT INTO work_experience (user_id, company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
					[
						req.user.id,
						String(exp.company).trim(),
						String(exp.title).trim(),
						exp.location,
						exp.start_date ? new Date(`${exp.start_date}-01`) : null,
						exp.end_date && exp.end_date !== 'Present' ? new Date(`${exp.end_date}-01`) : null,
						exp.is_current || exp.end_date === 'Present',
						exp.description,
						JSON.stringify(exp.achievements || []),
						JSON.stringify(exp.skills_used || []),
						i,
					],
				);
			}
		}

		// Apply education
		if (sections.includes('education') && parsed_data.education) {
			for (let i = 0; i < parsed_data.education.length; i++) {
				const edu = parsed_data.education[i];
				await pool.query(
					`
          INSERT INTO education (user_id, institution, degree, field_of_study, start_date, end_date, gpa, achievements, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
					[
						req.user.id,
						edu.institution,
						edu.degree,
						edu.field,
						edu.start_date ? new Date(`${edu.start_date}-01-01`) : null,
						edu.end_date && edu.end_date !== 'Present' ? new Date(`${edu.end_date}-01-01`) : null,
						edu.gpa,
						JSON.stringify(edu.achievements || []),
						i,
					],
				);
			}
		}

		// Apply skills
		if (sections.includes('skills') && parsed_data.skills) {
			for (const skill of parsed_data.skills) {
				// Coerce string level names to integers
				let skillLevel = skill.level || 3;
				if (typeof skillLevel === 'string') {
					const lvlMap = { beginner: 1, basic: 2, intermediate: 3, advanced: 4, expert: 5 };
					skillLevel = lvlMap[skillLevel.toLowerCase()] || parseInt(skillLevel, 10) || 3;
				}
				skillLevel = Math.max(1, Math.min(5, parseInt(skillLevel, 10) || 3));
				await pool.query(
					`
          INSERT INTO candidate_skills (user_id, skill_name, category, level)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, skill_name) DO UPDATE SET
            category = COALESCE($3, candidate_skills.category),
            level = GREATEST(candidate_skills.level, $4)
        `,
					[req.user.id, skill.name, skill.category || 'technical', skillLevel],
				);
			}
		}

		res.json({ success: true, message: 'Resume data applied to profile' });
	} catch (err) {
		console.error('Apply resume error:', err);
		res.status(500).json({ error: 'Failed to apply resume data' });
	}
});

// ============= CV REVIEW / ANALYSIS =============

// Helper: generate realistic mock CV analysis
function generateMockAnalysis() {
	const sections = [
		{
			name: 'Experience',
			score: Math.floor(Math.random() * 25) + 65, // 65-90
			impact: 'Highest',
			recommendations: [
				'Quantify achievements with metrics (e.g., "increased revenue by 20%")',
				'Use strong action verbs at the beginning of each bullet point',
				'Include 3-5 bullet points per role with clear outcomes',
			],
		},
		{
			name: 'Skills',
			score: Math.floor(Math.random() * 30) + 60, // 60-90
			impact: 'Medium',
			recommendations: [
				'Group skills by category (e.g., Technical, Soft Skills, Languages)',
				'Prioritize skills mentioned in target job descriptions',
				'Remove outdated or irrelevant skills to keep the list focused',
			],
		},
		{
			name: 'ATS & Recruiter Optimization',
			score: Math.floor(Math.random() * 35) + 55, // 55-90
			impact: 'Highest',
			recommendations: [
				'Include relevant keywords from the job posting naturally',
				'Avoid tables, headers/footers, and graphics that confuse ATS parsers',
				'Use standard section headings like "Work Experience" and "Education"',
			],
		},
		{
			name: 'Formatting & Layout',
			score: Math.floor(Math.random() * 30) + 60, // 60-90
			impact: 'Low',
			recommendations: [
				'Maintain consistent spacing and alignment throughout',
				'Use a clean, professional font (e.g., Arial, Calibri, Helvetica)',
				'Keep the resume to 1-2 pages for optimal readability',
			],
		},
		{
			name: 'Education',
			score: Math.floor(Math.random() * 20) + 70, // 70-90
			impact: 'Low',
			recommendations: [
				'Include relevant coursework or certifications if applicable',
				'List GPA only if it is 3.5 or above and recent',
				'Add honors, awards, or extracurriculars that demonstrate leadership',
			],
		},
	];

	const overallScore = Math.round(
		sections.reduce((sum, s) => sum + s.score, 0) / sections.length,
	);

	return {
		overall_score: overallScore,
		section_scores: sections,
		recommendations: sections.flatMap((s) =>
			s.recommendations.map((r) => ({
				section: s.name,
				impact: s.impact,
				text: r,
			})),
		),
	};
}

// Trigger CV analysis (async-style)
router.post('/cv/analyze', authMiddleware, async (req, res) => {
	try {
		// Premium gating: CV Review is Pro-only
		const access = await checkFeatureAccess(req.user, 'cv_review');
		if (!access.allowed) {
			return res.status(403).json({
				error: 'Upgrade to Pro to access CV Review',
				code: 'UPGRADE_REQUIRED',
				feature: 'cv_review',
				upgradeUrl: '/pricing',
			});
		}

		// Check user has uploaded documents (parsed_resumes)
		const docs = await pool.query(
			'SELECT id FROM parsed_resumes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
			[req.user.id],
		);

		if (docs.rows.length === 0) {
			return res.status(400).json({
				error: 'No uploaded document found. Please upload your CV first.',
				code: 'NO_DOCUMENT',
			});
		}

		const documentId = docs.rows[0].id;

		// Create analysis record in pending state
		const result = await pool.query(
			`
			INSERT INTO cv_analyses (user_id, document_id, status)
			VALUES ($1, $2, 'pending')
			RETURNING id
			`,
			[req.user.id, documentId],
		);

		const analysisId = result.rows[0].id;

		// Async mock analysis — complete immediately in MVP
		setImmediate(async () => {
			try {
				const mock = generateMockAnalysis();
				await pool.query(
					`
					UPDATE cv_analyses
					SET status = 'completed',
						overall_score = $2,
						section_scores = $3,
						recommendations = $4,
						updated_at = NOW()
					WHERE id = $1
					`,
					[analysisId, mock.overall_score, JSON.stringify(mock.section_scores), JSON.stringify(mock.recommendations)],
				);
				console.log(`[CV Review] Mock analysis completed for user ${req.user.id}, analysis ${analysisId}`);
			} catch (asyncErr) {
				console.error(`[CV Review] Async mock analysis failed for analysis ${analysisId}:`, asyncErr.message);
				try {
					await pool.query(
						"UPDATE cv_analyses SET status = 'failed', updated_at = NOW() WHERE id = $1",
						[analysisId],
					);
				} catch (markErr) {
					console.error('[CV Review] Failed to mark analysis as failed:', markErr.message);
				}
			}
		});

		res.json({ success: true, analysis_id: analysisId, status: 'pending' });
	} catch (err) {
		console.error('CV analyze error:', err);
		res.status(500).json({ error: 'Failed to start CV analysis' });
	}
});

// Get analysis result by ID
router.get('/cv/analysis/:id', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`
			SELECT id, user_id, document_id, status, overall_score, section_scores, recommendations, created_at, updated_at
			FROM cv_analyses
			WHERE id = $1 AND user_id = $2
			`,
			[req.params.id, req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Analysis not found' });
		}

		const row = result.rows[0];
		res.json({
			success: true,
			analysis: {
				id: row.id,
				user_id: row.user_id,
				document_id: row.document_id,
				status: row.status,
				overall_score: row.overall_score,
				section_scores: row.section_scores,
				recommendations: row.recommendations,
				created_at: row.created_at,
				updated_at: row.updated_at,
			},
		});
	} catch (err) {
		console.error('Get CV analysis error:', err);
		res.status(500).json({ error: 'Failed to get CV analysis' });
	}
});

// List user's analyses with pagination
router.get('/cv/analyses', authMiddleware, async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
		const offset = parseInt(req.query.offset, 10) || 0;

		const analysesResult = await pool.query(
			`
			SELECT id, user_id, document_id, status, overall_score, created_at, updated_at
			FROM cv_analyses
			WHERE user_id = $1
			ORDER BY created_at DESC
			LIMIT $2 OFFSET $3
			`,
			[req.user.id, limit, offset],
		);

		const countResult = await pool.query(
			'SELECT COUNT(*) as total FROM cv_analyses WHERE user_id = $1',
			[req.user.id],
		);
		const total = parseInt(countResult.rows[0].total, 10);

		res.json({
			success: true,
			analyses: analysesResult.rows,
			pagination: {
				total,
				limit,
				offset,
				page: Math.floor(offset / limit) + 1,
				has_more: offset + analysesResult.rows.length < total,
			},
		});
	} catch (err) {
		console.error('List CV analyses error:', err);
		res.status(500).json({ error: 'Failed to list CV analyses' });
	}
});

// ============= AI CV REVIEW (#82) =============

// POST /cv-review — create AI-powered CV review
router.post('/cv-review', authMiddleware, async (req, res) => {
	try {
		const { document_id, cv_text } = req.body;

		// Validate input: at least one source required
		if (!document_id && !cv_text) {
			return res.status(400).json({
				error: 'Either document_id or cv_text is required',
				code: 'MISSING_INPUT',
			});
		}

		// Premium gating
		const access = await checkFeatureAccess(req.user, 'cv_review');
		if (!access.allowed) {
			return res.status(403).json({
				error: 'Upgrade to Pro to access CV Review',
				code: 'UPGRADE_REQUIRED',
				feature: 'cv_review',
				upgradeUrl: '/pricing',
			});
		}

		let reviewText = cv_text || '';
		let resolvedDocumentId = document_id || null;

		// If document_id provided, fetch parsed resume text
		if (document_id) {
			const docResult = await pool.query(
				'SELECT id, parsed_data FROM parsed_resumes WHERE id = $1 AND user_id = $2',
				[document_id, req.user.id],
			);
			if (docResult.rows.length === 0) {
				return res.status(404).json({
					error: 'Document not found',
					code: 'DOCUMENT_NOT_FOUND',
				});
			}
			// Use parsed_data JSONB as text source
			const parsedData = docResult.rows[0].parsed_data;
			reviewText = parsedData ? JSON.stringify(parsedData) : '';
			if (!reviewText.trim()) {
				return res.status(400).json({
					error: 'Document has no parsed content. Please upload a valid CV.',
					code: 'EMPTY_DOCUMENT',
				});
			}
		}

		// Build AI prompt
		const prompt = `You are an expert CV/resume reviewer. Review the following CV and provide structured feedback.

CV CONTENT:
${reviewText.substring(0, 12000)}

Provide your analysis as a JSON object with exactly this structure:
{
  "score": <number 0-100>,
  "sections": [
    {
      "name": "<section name>",
      "score": <number 0-100>,
      "feedback": "<detailed feedback for this section>",
      "priority": "<highest|medium|optional>"
    }
  ],
  "overall_feedback": "<2-3 sentence overall summary>"
}

Evaluate these areas: Experience, Skills, Education, Formatting, and ATS Optimization. Be constructive and specific.`;

		// Call AI
		const { chat } = require('../lib/polsia-ai');
		const aiResponse = await chat(prompt, {
			task: 'cv-review',
			module: 'candidate',
			feature: 'cv_review',
		});

		// Parse AI response
		const { safeParseJSON } = require('../lib/polsia-ai');
		const reviewData = safeParseJSON(aiResponse);
		if (!reviewData) {
			return res.status(502).json({
				error: 'AI response could not be parsed',
				code: 'AI_PARSE_ERROR',
			});
		}

		// Save to cv_reviews table
		const insertResult = await pool.query(
			`
			INSERT INTO cv_reviews (user_id, document_id, review_data)
			VALUES ($1, $2, $3)
			RETURNING id, user_id, document_id, review_data, created_at
			`,
			[req.user.id, resolvedDocumentId, JSON.stringify(reviewData)],
		);

		// Track usage
		try {
			await incrementUsage(req.user.id, 'cv_review');
		} catch (usageErr) {
			console.error('[CV Review] Usage tracking failed (non-fatal):', usageErr.message);
		}

		res.json({
			success: true,
			review: insertResult.rows[0],
		});
	} catch (err) {
		console.error('CV review error:', err);
		res.status(500).json({ error: 'Failed to generate CV review' });
	}
});

// GET /cv-review — return most recent CV review for authenticated user
router.get('/cv-review', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`
			SELECT id, user_id, document_id, review_data, created_at
			FROM cv_reviews
			WHERE user_id = $1
			ORDER BY created_at DESC
			LIMIT 1
			`,
			[req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({
				error: 'No CV review found',
				code: 'NOT_FOUND',
			});
		}

		res.json({
			success: true,
			review: result.rows[0],
		});
	} catch (err) {
		console.error('Get CV review error:', err);
		res.status(500).json({ error: 'Failed to get CV review' });
	}
});

// ============= WORK EXPERIENCE =============

router.post('/experience', authMiddleware, async (req, res) => {
	try {
		const {
			company_name,
			title,
			location,
			start_date,
			end_date,
			is_current,
			description,
			achievements,
			skills_used,
		} = req.body;

		if (!company_name || !String(company_name).trim()) {
			return res.status(400).json({ error: 'Company name is required' });
		}
		if (!title || !String(title).trim()) {
			return res.status(400).json({ error: 'Job title is required' });
		}

		const result = await pool.query(
			`
      INSERT INTO work_experience (user_id, company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
			[
				req.user.id,
				String(company_name).trim(),
				String(title).trim(),
				location,
				start_date,
				end_date,
				is_current,
				description,
				JSON.stringify(achievements || []),
				JSON.stringify(skills_used || []),
			],
		);

		triggerProfileUpdate(req.user.id, 'new_experience');
		res.json({ success: true, experience: result.rows[0] });
	} catch (err) {
		console.error('Add experience error:', err);
		res.status(500).json({ error: 'Failed to add experience' });
	}
});

router.put('/experience/:id', authMiddleware, async (req, res) => {
	try {
		const {
			company_name,
			title,
			location,
			start_date,
			end_date,
			is_current,
			description,
			achievements,
			skills_used,
		} = req.body;

		const result = await pool.query(
			`
      UPDATE work_experience SET
        company_name = COALESCE($3, company_name),
        title = COALESCE($4, title),
        location = COALESCE($5, location),
        start_date = COALESCE($6, start_date),
        end_date = $7,
        is_current = COALESCE($8, is_current),
        description = COALESCE($9, description),
        achievements = COALESCE($10, achievements),
        skills_used = COALESCE($11, skills_used)
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
			[
				req.params.id,
				req.user.id,
				company_name,
				title,
				location,
				start_date,
				end_date,
				is_current,
				description,
				achievements ? JSON.stringify(achievements) : null,
				skills_used ? JSON.stringify(skills_used) : null,
			],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Experience not found' });
		}

		triggerProfileUpdate(req.user.id, 'updated_experience');
		res.json({ success: true, experience: result.rows[0] });
	} catch (err) {
		console.error('Update experience error:', err);
		res.status(500).json({ error: 'Failed to update experience' });
	}
});

router.delete('/experience/:id', authMiddleware, async (req, res) => {
	try {
		await pool.query('DELETE FROM work_experience WHERE id = $1 AND user_id = $2', [
			req.params.id,
			req.user.id,
		]);
		triggerProfileUpdate(req.user.id, 'deleted_experience');
		res.json({ success: true });
	} catch (err) {
		console.error('Delete experience error:', err);
		res.status(500).json({ error: 'Failed to delete experience' });
	}
});

// ============= EDUCATION =============

router.post('/education', authMiddleware, async (req, res) => {
	try {
		const {
			institution,
			degree,
			field_of_study,
			start_date,
			end_date,
			is_current,
			gpa,
			achievements,
		} = req.body;

		const result = await pool.query(
			`
      INSERT INTO education (user_id, institution, degree, field_of_study, start_date, end_date, is_current, gpa, achievements)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
			[
				req.user.id,
				institution,
				degree,
				field_of_study,
				start_date,
				end_date,
				is_current,
				gpa,
				JSON.stringify(achievements || []),
			],
		);

		triggerProfileUpdate(req.user.id, 'new_education');
		res.json({ success: true, education: result.rows[0] });
	} catch (err) {
		console.error('Add education error:', err);
		res.status(500).json({ error: 'Failed to add education' });
	}
});

router.put('/education/:id', authMiddleware, async (req, res) => {
	try {
		const {
			institution,
			degree,
			field_of_study,
			start_date,
			end_date,
			is_current,
			gpa,
			achievements,
		} = req.body;

		const result = await pool.query(
			`
      UPDATE education SET
        institution = COALESCE($3, institution),
        degree = COALESCE($4, degree),
        field_of_study = COALESCE($5, field_of_study),
        start_date = COALESCE($6, start_date),
        end_date = $7,
        is_current = COALESCE($8, is_current),
        gpa = COALESCE($9, gpa),
        achievements = COALESCE($10, achievements)
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
			[
				req.params.id,
				req.user.id,
				institution,
				degree,
				field_of_study,
				start_date,
				end_date,
				is_current,
				gpa,
				achievements ? JSON.stringify(achievements) : null,
			],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Education not found' });
		}

		triggerProfileUpdate(req.user.id, 'updated_education');
		res.json({ success: true, education: result.rows[0] });
	} catch (err) {
		console.error('Update education error:', err);
		res.status(500).json({ error: 'Failed to update education' });
	}
});

router.delete('/education/:id', authMiddleware, async (req, res) => {
	try {
		await pool.query('DELETE FROM education WHERE id = $1 AND user_id = $2', [
			req.params.id,
			req.user.id,
		]);
		triggerProfileUpdate(req.user.id, 'deleted_education');
		res.json({ success: true });
	} catch (err) {
		console.error('Delete education error:', err);
		res.status(500).json({ error: 'Failed to delete education' });
	}
});

// ============= SKILLS =============

router.get('/skills', authMiddleware, async (req, res) => {
	try {
		const skills = await pool.query(
			'SELECT * FROM candidate_skills WHERE user_id = $1 ORDER BY category, level DESC',
			[req.user.id],
		);
		res.json({ success: true, skills: skills.rows });
	} catch (err) {
		console.error('Get skills error:', err);
		res.status(500).json({ error: 'Failed to get skills' });
	}
});

router.post('/skills', authMiddleware, async (req, res) => {
	try {
		const { skill_name, category, years_experience } = req.body;
		let { level } = req.body;

		if (!skill_name || !String(skill_name).trim()) {
			return res.status(400).json({ error: 'Skill name is required' });
		}

		// Coerce string level names to integers (DB expects integer 1-5)
		if (typeof level === 'string') {
			const levelMap = { beginner: 1, basic: 2, intermediate: 3, advanced: 4, expert: 5 };
			level = levelMap[level.toLowerCase()] || parseInt(level, 10) || 3;
		}
		level = Math.max(1, Math.min(5, parseInt(level, 10) || 3));

		const result = await pool.query(
			`
      INSERT INTO candidate_skills (user_id, skill_name, category, level, years_experience)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, skill_name) DO UPDATE SET
        category = COALESCE($3, candidate_skills.category),
        level = COALESCE($4, candidate_skills.level),
        years_experience = COALESCE($5, candidate_skills.years_experience)
      RETURNING *
    `,
			[
				req.user.id,
				String(skill_name).trim(),
				category || 'technical',
				level,
				years_experience || 0,
			],
		);

		triggerProfileUpdate(req.user.id, 'new_skill');
		res.json({ success: true, skill: result.rows[0] });
	} catch (err) {
		console.error('Add skill error:', err);
		res.status(500).json({ error: 'Failed to add skill' });
	}
});

router.put('/skills/:id', authMiddleware, async (req, res) => {
	try {
		const { category, years_experience } = req.body;
		let { level } = req.body;

		// Coerce string level names to integers (DB expects integer 1-5)
		if (level !== undefined && level !== null) {
			if (typeof level === 'string') {
				const levelMap = { beginner: 1, basic: 2, intermediate: 3, advanced: 4, expert: 5 };
				level = levelMap[level.toLowerCase()] || parseInt(level, 10) || null;
			}
			if (level !== null) level = Math.max(1, Math.min(5, parseInt(level, 10) || 3));
		}

		const result = await pool.query(
			`
      UPDATE candidate_skills SET
        level = COALESCE($3, level),
        category = COALESCE($4, category),
        years_experience = COALESCE($5, years_experience)
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
			[parseInt(req.params.id, 10), req.user.id, level, category, years_experience],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Skill not found' });
		}

		triggerProfileUpdate(req.user.id, 'updated_skill');
		res.json({ success: true, skill: result.rows[0] });
	} catch (err) {
		console.error('Update skill error:', err);
		res.status(500).json({ error: 'Failed to update skill' });
	}
});

router.delete('/skills/:id', authMiddleware, async (req, res) => {
	try {
		await pool.query('DELETE FROM candidate_skills WHERE id = $1 AND user_id = $2', [
			parseInt(req.params.id, 10),
			req.user.id,
		]);
		res.json({ success: true });
	} catch (err) {
		console.error('Delete skill error:', err);
		res.status(500).json({ error: 'Failed to delete skill' });
	}
});

// ============= SKILL ASSESSMENTS =============

router.get('/assessments', authMiddleware, async (req, res) => {
	try {
		const assessments = await pool.query(
			`
      SELECT sa.*, cs.skill_name
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      WHERE sa.user_id = $1
      ORDER BY sa.created_at DESC
    `,
			[req.user.id],
		);

		res.json({ success: true, assessments: assessments.rows });
	} catch (err) {
		console.error('Get assessments error:', err);
		res.status(500).json({ error: 'Failed to get assessments' });
	}
});

// Start a new skill assessment
router.post('/assessments/start', authMiddleware, async (req, res) => {
	try {
		const { skill_name, category } = req.body;
		// Coerce skill_id to integer (FK to candidate_skills.id)
		const skill_id = req.body.skill_id ? parseInt(req.body.skill_id, 10) : null;
		// Coerce skill_level to integer
		let skill_level = req.body.skill_level || 3;
		if (typeof skill_level === 'string') {
			const lvlMap = { beginner: 1, basic: 2, intermediate: 3, advanced: 4, expert: 5 };
			skill_level = lvlMap[skill_level.toLowerCase()] || parseInt(skill_level, 10) || 3;
		}

		// Get user's subscription
		const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
			req.user.id,
		]);
		const subscriptionId = user.rows[0]?.stripe_subscription_id;

		// Generate assessment questions
		const questions = await generateSkillAssessment(
			skill_name,
			skill_level,
			category || 'technical',
			{ subscriptionId },
		);

		// Create assessment record
		const result = await pool.query(
			`
      INSERT INTO skill_assessments (user_id, skill_id, assessment_type, title, questions, started_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `,
			[
				req.user.id,
				skill_id,
				'skill_verification',
				`${skill_name || 'Skill'} Assessment`,
				JSON.stringify(questions),
			],
		);

		res.json({
			success: true,
			assessment: result.rows[0],
			questions: questions.map((q) => ({
				question: q.question,
				options: q.options,
				difficulty: q.difficulty,
			})),
		});
	} catch (err) {
		console.error('Start assessment error:', err);
		res.status(500).json({ error: 'Failed to start assessment' });
	}
});

// Submit assessment answers
router.post('/assessments/:id/submit', authMiddleware, async (req, res) => {
	try {
		const { responses } = req.body;
		const assessmentId = req.params.id;

		// Get the assessment
		const assessment = await pool.query(
			'SELECT * FROM skill_assessments WHERE id = $1 AND user_id = $2',
			[assessmentId, req.user.id],
		);

		if (assessment.rows.length === 0) {
			return res.status(404).json({ error: 'Assessment not found' });
		}

		const questions = assessment.rows[0].questions;

		// Get skill name for evaluation
		let skillName = assessment.rows[0].title.replace(' Assessment', '');
		if (assessment.rows[0].skill_id) {
			const skill = await pool.query('SELECT skill_name FROM candidate_skills WHERE id = $1', [
				assessment.rows[0].skill_id,
			]);
			if (skill.rows.length > 0) skillName = skill.rows[0].skill_name;
		}

		// Get user's subscription
		const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
			req.user.id,
		]);
		const subscriptionId = user.rows[0]?.stripe_subscription_id;

		// Evaluate with AI
		const evaluation = await evaluateSkillAssessment(questions, responses, skillName, {
			subscriptionId,
		});

		// Update assessment record
		await pool.query(
			`
      UPDATE skill_assessments SET
        responses = $2,
        score = $3,
        passed = $4,
        ai_feedback = $5,
        completed_at = NOW()
      WHERE id = $1
    `,
			[
				assessmentId,
				JSON.stringify(responses),
				evaluation.score,
				evaluation.passed,
				JSON.stringify(evaluation),
			],
		);

		// If passed, verify the skill
		if (evaluation.passed && assessment.rows[0].skill_id) {
			await pool.query(
				`
        UPDATE candidate_skills SET
          is_verified = true,
          verified_at = NOW(),
          verified_score = $2,
          level = GREATEST(level, $3)
        WHERE id = $1
      `,
				[assessment.rows[0].skill_id, evaluation.score, evaluation.recommended_level || 3],
			);
		}

		res.json({
			success: true,
			evaluation,
			passed: evaluation.passed,
		});
	} catch (err) {
		console.error('Submit assessment error:', err);
		res.status(500).json({ error: 'Failed to submit assessment' });
	}
});

// ============= PORTFOLIO PROJECTS =============

router.post('/projects', authMiddleware, async (req, res) => {
	try {
		const {
			title,
			description,
			project_url,
			github_url,
			image_url,
			technologies,
			role,
			start_date,
			end_date,
			highlights,
		} = req.body;

		if (!title || !String(title).trim()) {
			return res.status(400).json({ error: 'Project title is required' });
		}

		const result = await pool.query(
			`
      INSERT INTO portfolio_projects (user_id, title, description, project_url, github_url, image_url, technologies, role, start_date, end_date, highlights)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `,
			[
				req.user.id,
				String(title).trim(),
				description,
				project_url,
				github_url,
				image_url,
				JSON.stringify(technologies || []),
				role,
				start_date,
				end_date,
				JSON.stringify(highlights || []),
			],
		);

		res.json({ success: true, project: result.rows[0] });
	} catch (err) {
		console.error('Add project error:', err);
		res.status(500).json({ error: 'Failed to add project' });
	}
});

router.put('/projects/:id', authMiddleware, async (req, res) => {
	try {
		const {
			title,
			description,
			project_url,
			github_url,
			image_url,
			technologies,
			role,
			start_date,
			end_date,
			highlights,
		} = req.body;

		const result = await pool.query(
			`
      UPDATE portfolio_projects SET
        title = COALESCE($3, title),
        description = COALESCE($4, description),
        project_url = COALESCE($5, project_url),
        github_url = COALESCE($6, github_url),
        image_url = COALESCE($7, image_url),
        technologies = COALESCE($8, technologies),
        role = COALESCE($9, role),
        start_date = COALESCE($10, start_date),
        end_date = $11,
        highlights = COALESCE($12, highlights)
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
			[
				req.params.id,
				req.user.id,
				title,
				description,
				project_url,
				github_url,
				image_url,
				technologies ? JSON.stringify(technologies) : null,
				role,
				start_date,
				end_date,
				highlights ? JSON.stringify(highlights) : null,
			],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Project not found' });
		}

		res.json({ success: true, project: result.rows[0] });
	} catch (err) {
		console.error('Update project error:', err);
		res.status(500).json({ error: 'Failed to update project' });
	}
});

router.delete('/projects/:id', authMiddleware, async (req, res) => {
	try {
		await pool.query('DELETE FROM portfolio_projects WHERE id = $1 AND user_id = $2', [
			req.params.id,
			req.user.id,
		]);
		res.json({ success: true });
	} catch (err) {
		console.error('Delete project error:', err);
		res.status(500).json({ error: 'Failed to delete project' });
	}
});

// ============= JOB MATCHING =============

// Get all active jobs with candidate personalization
router.get('/jobs', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const {
			search,
			location,
			job_type,
			salary_min,
			salary_max,
			remoteType,
			experienceLevel,
			skills,
			companySize,
			sortBy = 'newest',
			limit = 20,
			offset = 0,
			page,
			pageSize,
		} = req.query;

		// Support both page-based and offset-based pagination
		const pageLimit = Math.min(parseInt(pageSize, 10) || parseInt(limit, 10) || 20, 50);
		const pageOffset = page ? (parseInt(page, 10) - 1) * pageLimit : parseInt(offset, 10) || 0;

		const params = [];
		let paramIndex = 1;

		// Exclude dismissed jobs from main feed
		let whereClause = "WHERE j.status = 'active' AND NOT EXISTS (SELECT 1 FROM candidate_job_actions cja WHERE cja.job_id = j.id AND cja.user_id = $1 AND cja.action_type = 'dismiss')";
		params.push(userId);
		paramIndex++;

		// Core text filters
		if (search) {
			whereClause += ` AND (j.title ILIKE $${paramIndex} OR j.description ILIKE $${paramIndex} OR j.company ILIKE $${paramIndex})`;
			params.push(`%${search}%`);
			paramIndex++;
		}
		if (location) {
			whereClause += ` AND j.location ILIKE $${paramIndex}`;
			params.push(`%${location}%`);
			paramIndex++;
		}
		if (job_type) {
			whereClause += ` AND j.job_type = $${paramIndex}`;
			params.push(job_type);
			paramIndex++;
		}
		if (salary_min) {
			whereClause += ` AND j.salary_max >= $${paramIndex}`;
			params.push(parseInt(salary_min, 10));
			paramIndex++;
		}
		if (salary_max) {
			whereClause += ` AND j.salary_min <= $${paramIndex}`;
			params.push(parseInt(salary_max, 10));
			paramIndex++;
		}

		// Extended filters (graceful — if column missing, query will fail gracefully in catch)
		if (remoteType) {
			whereClause += ` AND (j.remote_type = $${paramIndex} OR j.location ILIKE $${paramIndex + 1})`;
			params.push(remoteType, `%${remoteType}%`);
			paramIndex += 2;
		}
		if (experienceLevel) {
			whereClause += ` AND j.experience_level = $${paramIndex}`;
			params.push(experienceLevel);
			paramIndex++;
		}
		if (skills) {
			const skillList = Array.isArray(skills) ? skills : skills.split(',').filter(Boolean);
			if (skillList.length > 0) {
				const skillClauses = skillList
					.map((_, i) => `j.skills_required ::jsonb ? $${paramIndex + i}`)
					.join(' OR ');
				whereClause += ` AND (${skillClauses})`;
				params.push(...skillList);
				paramIndex += skillList.length;
			}
		}
		if (companySize) {
			whereClause += ` AND c.company_size = $${paramIndex}`;
			params.push(companySize);
			paramIndex++;
		}

		// ORDER BY clause
		let orderBy = 'j.created_at DESC';
		if (sortBy === 'salary_high') orderBy = 'j.salary_max DESC NULLS LAST';
		else if (sortBy === 'salary_low') orderBy = 'j.salary_min ASC NULLS LAST';
		else if (sortBy === 'match') orderBy = 'j.created_at DESC'; // placeholder until match scoring is integrated

		const joinClause = 'LEFT JOIN companies c ON j.company_id = c.id';

		const jobsQuery = `
      SELECT
        j.id, j.title, j.description, j.company, j.company as poster_company, j.location, j.job_type,
        j.salary_min, j.salary_max, j.salary_range, j.currency_code, j.country_code,
        j.skills_required, j.status, j.created_at, j.updated_at, j.screening_questions,
        j.requirements, j.user_id, j.remote_type, j.experience_level,
        c.company_size,
        EXISTS(SELECT 1 FROM job_applications a WHERE a.job_id = j.id AND a.candidate_id = $1 LIMIT 1) as has_applied,
        EXISTS(SELECT 1 FROM saved_jobs sj WHERE sj.job_id = j.id AND sj.user_id = $1 LIMIT 1) as has_saved
      FROM jobs j
      ${joinClause}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
		params.push(pageLimit, pageOffset);

		const jobsResult = await pool.query(jobsQuery, params);

		const countQuery = `
      SELECT COUNT(*) as total
      FROM jobs j
      ${joinClause}
      ${whereClause}
    `;
		const countResult = await pool.query(countQuery, params.slice(0, paramIndex - 1));
		const total = parseInt(countResult.rows[0].total, 10);

		res.json({
			success: true,
			data: jobsResult.rows.map((row) => ({
				...row,
				has_applied: row.has_applied,
				has_saved: row.has_saved,
			})),
			jobs: jobsResult.rows.map((row) => ({
				...row,
				has_applied: row.has_applied,
				has_saved: row.has_saved,
			})),
			pagination: {
				total,
				limit: pageLimit,
				offset: pageOffset,
				page: Math.floor(pageOffset / pageLimit) + 1,
				has_more: pageOffset + jobsResult.rows.length < total,
			},
		});
	} catch (error) {
		console.error('Error fetching jobs:', error);
		res.status(500).json({ error: 'Failed to fetch jobs' });
	}
});

// Get jobs with match scores
router.get('/jobs/recommended', authMiddleware, async (req, res) => {
	try {
		const { limit = 20 } = req.query;

		// Get candidate profile
		const profile = await pool.query(
			`
      SELECT cp.*, u.name, os.total_score as omniscore
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE u.id = $1
    `,
			[req.user.id],
		);

		const skills = await pool.query('SELECT skill_name FROM candidate_skills WHERE user_id = $1', [
			req.user.id,
		]);

		const experience = await pool.query(
			'SELECT title FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3',
			[req.user.id],
		);

		// Get active jobs
		const jobs = await pool.query(
			`
      SELECT j.*, u.company_name as posted_by_company
      FROM jobs j
      LEFT JOIN users u ON j.user_id = u.id
      WHERE j.status = 'active'
      ORDER BY j.created_at DESC
      LIMIT $1
    `,
			[limit],
		);

		const candidateProfile = {
			...profile.rows[0],
			skills: skills.rows,
			titles: experience.rows.map((e) => e.title),
		};

		// Calculate match scores for each job
		const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
			req.user.id,
		]);
		const subscriptionId = user.rows[0]?.stripe_subscription_id;

		const jobsWithScores = await Promise.all(
			jobs.rows.map(async (job) => {
				try {
					const match = await generateJobMatchScore(candidateProfile, job, { subscriptionId });
					return { ...job, match };
				} catch (_e) {
					return { ...job, match: { match_score: 50, match_level: 'fair' } };
				}
			}),
		);

		// Sort by match score
		jobsWithScores.sort((a, b) => (b.match?.match_score || 0) - (a.match?.match_score || 0));

		res.json({
			success: true,
			jobs: jobsWithScores,
			recommended_jobs: jobsWithScores,
		});
	} catch (err) {
		console.error('Get recommended jobs error:', err);
		res.status(500).json({ error: 'Failed to get recommended jobs' });
	}
});

// Save a job
router.post('/jobs/:jobId/save', authMiddleware, async (req, res) => {
	try {
		const { notes } = req.body;

		await pool.query(
			`
      INSERT INTO saved_jobs (user_id, job_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, job_id) DO UPDATE SET notes = $3
    `,
			[req.user.id, req.params.jobId, notes],
		);

		res.json({ success: true });
	} catch (err) {
		console.error('Save job error:', err);
		res.status(500).json({ error: 'Failed to save job' });
	}
});

router.delete('/jobs/:jobId/save', authMiddleware, async (req, res) => {
	try {
		await pool.query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2', [
			req.user.id,
			req.params.jobId,
		]);
		res.json({ success: true });
	} catch (err) {
		console.error('Unsave job error:', err);
		res.status(500).json({ error: 'Failed to unsave job' });
	}
});

// Get saved jobs
router.get('/jobs/saved', authMiddleware, async (req, res) => {
	try {
		const jobs = await pool.query(
			`
      SELECT j.*, sj.saved_at, sj.notes, u.company_name as posted_by_company
      FROM saved_jobs sj
      JOIN jobs j ON sj.job_id = j.id
      LEFT JOIN users u ON j.user_id = u.id
      WHERE sj.user_id = $1
      ORDER BY sj.saved_at DESC
    `,
			[req.user.id],
		);

		res.json({ success: true, jobs: jobs.rows });
	} catch (err) {
		console.error('Get saved jobs error:', err);
		res.status(500).json({ error: 'Failed to get saved jobs' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// /saved-jobs — frontend-compatible alias routes
// ════════════════════════════════════════════════════════════════════════

// GET /saved-jobs — returns { saved_jobs: [{ job_id, saved_at }] }
router.get('/saved-jobs', authMiddleware, async (req, res) => {
	try {
		const jobs = await pool.query(
			`
      SELECT j.id as job_id, sj.saved_at
      FROM saved_jobs sj
      JOIN jobs j ON sj.job_id = j.id
      WHERE sj.user_id = $1
      ORDER BY sj.saved_at DESC
    `,
			[req.user.id],
		);
		res.json({ success: true, saved_jobs: jobs.rows, data: jobs.rows });
	} catch (err) {
		console.error('Get saved jobs error:', err);
		res.status(500).json({ error: 'Failed to get saved jobs' });
	}
});

// POST /saved-jobs — body { job_id, notes? }
router.post('/saved-jobs', authMiddleware, async (req, res) => {
	try {
		const { job_id, notes } = req.body;
		if (!job_id) return res.status(400).json({ error: 'job_id is required' });
		await pool.query(
			`
      INSERT INTO saved_jobs (user_id, job_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, job_id) DO UPDATE SET notes = $3
    `,
			[req.user.id, job_id, notes || null],
		);
		res.json({ success: true });
	} catch (err) {
		console.error('Save job error:', err);
		res.status(500).json({ error: 'Failed to save job' });
	}
});

// DELETE /saved-jobs/:jobId
router.delete('/saved-jobs/:jobId', authMiddleware, async (req, res) => {
	try {
		await pool.query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2', [
			req.user.id,
			req.params.jobId,
		]);
		res.json({ success: true });
	} catch (err) {
		console.error('Unsave job error:', err);
		res.status(500).json({ error: 'Failed to unsave job' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// /jobs/:jobId/like — Like a job (swipe right)
// ════════════════════════════════════════════════════════════════════════

// POST /jobs/:jobId/like
router.post('/jobs/:jobId/like', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!jobId || jobId <= 0) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		await pool.query(
			`
      INSERT INTO candidate_job_actions (user_id, job_id, action_type)
      VALUES ($1, $2, 'like')
      ON CONFLICT (user_id, job_id, action_type) DO NOTHING
    `,
			[req.user.id, jobId],
		);

		// Remove any dismiss record so the job reappears in the main feed
		await pool.query(
			"DELETE FROM candidate_job_actions WHERE user_id = $1 AND job_id = $2 AND action_type = 'dismiss'",
			[req.user.id, jobId],
		);

		res.json({ success: true });
	} catch (err) {
		console.error('Like job error:', err);
		res.status(500).json({ error: 'Failed to like job' });
	}
});

// DELETE /jobs/:jobId/like — Unlike a job
router.delete('/jobs/:jobId/like', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!jobId || jobId <= 0) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		await pool.query(
			"DELETE FROM candidate_job_actions WHERE user_id = $1 AND job_id = $2 AND action_type = 'like'",
			[req.user.id, jobId],
		);
		res.json({ success: true });
	} catch (err) {
		console.error('Unlike job error:', err);
		res.status(500).json({ error: 'Failed to unlike job' });
	}
});

// GET /jobs/liked — Get all liked jobs
router.get('/jobs/liked', authMiddleware, async (req, res) => {
	try {
		const jobs = await pool.query(
			`
      SELECT j.*, cja.created_at as liked_at,
             EXISTS(SELECT 1 FROM job_applications a WHERE a.job_id = j.id AND a.candidate_id = $1 LIMIT 1) as has_applied,
             EXISTS(SELECT 1 FROM saved_jobs sj WHERE sj.job_id = j.id AND sj.user_id = $1 LIMIT 1) as has_saved
      FROM candidate_job_actions cja
      JOIN jobs j ON cja.job_id = j.id
      WHERE cja.user_id = $1 AND cja.action_type = 'like'
      ORDER BY cja.created_at DESC
    `,
			[req.user.id],
		);
		res.json({ success: true, jobs: jobs.rows, liked_jobs: jobs.rows });
	} catch (err) {
		console.error('Get liked jobs error:', err);
		res.status(500).json({ error: 'Failed to get liked jobs' });
	}
});

// ════════════════════════════════════════════════════════════════════════
// /jobs/:jobId/dismiss — Dismiss a job (swipe left / trash)
// ════════════════════════════════════════════════════════════════════════

// POST /jobs/:jobId/dismiss
router.post('/jobs/:jobId/dismiss', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!jobId || jobId <= 0) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		await pool.query(
			`
      INSERT INTO candidate_job_actions (user_id, job_id, action_type)
      VALUES ($1, $2, 'dismiss')
      ON CONFLICT (user_id, job_id, action_type) DO NOTHING
    `,
			[req.user.id, jobId],
		);

		// Remove like and saved records so the job is fully dismissed
		await pool.query(
			"DELETE FROM candidate_job_actions WHERE user_id = $1 AND job_id = $2 AND action_type = 'like'",
			[req.user.id, jobId],
		);
		await pool.query(
			'DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
			[req.user.id, jobId],
		);

		res.json({ success: true });
	} catch (err) {
		console.error('Dismiss job error:', err);
		res.status(500).json({ error: 'Failed to dismiss job' });
	}
});

// DELETE /jobs/:jobId/dismiss — Restore a dismissed job
router.delete('/jobs/:jobId/dismiss', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!jobId || jobId <= 0) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		await pool.query(
			"DELETE FROM candidate_job_actions WHERE user_id = $1 AND job_id = $2 AND action_type = 'dismiss'",
			[req.user.id, jobId],
		);
		res.json({ success: true });
	} catch (err) {
		console.error('Restore job error:', err);
		res.status(500).json({ error: 'Failed to restore job' });
	}
});

// GET /jobs/dismissed — Get all dismissed jobs
router.get('/jobs/dismissed', authMiddleware, async (req, res) => {
	try {
		const jobs = await pool.query(
			`
      SELECT j.*, cja.created_at as dismissed_at,
             EXISTS(SELECT 1 FROM job_applications a WHERE a.job_id = j.id AND a.candidate_id = $1 LIMIT 1) as has_applied,
             EXISTS(SELECT 1 FROM saved_jobs sj WHERE sj.job_id = j.id AND sj.user_id = $1 LIMIT 1) as has_saved
      FROM candidate_job_actions cja
      JOIN jobs j ON cja.job_id = j.id
      WHERE cja.user_id = $1 AND cja.action_type = 'dismiss'
      ORDER BY cja.created_at DESC
    `,
			[req.user.id],
		);
		res.json({ success: true, jobs: jobs.rows, dismissed_jobs: jobs.rows });
	} catch (err) {
		console.error('Get dismissed jobs error:', err);
		res.status(500).json({ error: 'Failed to get dismissed jobs' });
	}
});

// Apply to a job
router.post('/jobs/:jobId/apply', authMiddleware, async (req, res) => {
	try {
		const { cover_letter, screening_answers } = req.body;

		// Get match score
		const profile = await pool.query(
			`
      SELECT cp.*, u.name, os.total_score as omniscore
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE u.id = $1
    `,
			[req.user.id],
		);

		const skills = await pool.query('SELECT skill_name FROM candidate_skills WHERE user_id = $1', [
			req.user.id,
		]);

		const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.jobId]);
		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		const existingApplication = await pool.query(
			'SELECT id FROM job_applications WHERE candidate_id = $1 AND job_id = $2',
			[req.user.id, req.params.jobId],
		);
		if (existingApplication.rows.length > 0) {
			return res.status(400).json({ error: 'You have already applied to this job' });
		}

		const candidateProfile = {
			...profile.rows[0],
			skills: skills.rows,
		};

		const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
			req.user.id,
		]);
		const subscriptionId = user.rows[0]?.stripe_subscription_id;

		let matchScore = 50;
		try {
			const match = await generateJobMatchScore(candidateProfile, job.rows[0], { subscriptionId });
			matchScore = match.match_score;
		} catch (_e) {}

		// Get omniscore for application
		const omniscore = profile.rows[0]?.omniscore || null;

		const result = await pool.query(
			`
      INSERT INTO job_applications (candidate_id, job_id, company_id, cover_letter, match_score, omniscore_at_apply, screening_answers, is_auto_applied)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
			[
				req.user.id,
				req.params.jobId,
				job.rows[0].company_id,
				cover_letter,
				matchScore,
				omniscore,
				JSON.stringify(screening_answers || {}),
				false,
			],
		);

		// ── Smart Data Enrichment: Extract profile data from screening answers ──
		if (screening_answers && Object.keys(screening_answers).length > 0) {
			try {
				const screeningQs = job.rows[0].screening_questions || [];
				const updates = {};

				for (const q of screeningQs) {
					const answer = screening_answers[q.id];
					if (!answer) continue;

					if (q.category === 'salary' && answer) {
						const nums = String(answer).match(/\d[\d,]*/g);
						if (nums && nums.length > 0) {
							updates.salary_min = parseInt(nums[0].replace(/,/g, ''), 10);
							if (nums.length > 1) updates.salary_max = parseInt(nums[1].replace(/,/g, ''), 10);
						}
					} else if (q.category === 'availability') {
						updates.availability = String(answer);
					} else if (q.category === 'experience') {
						const bracket = String(answer);
						if (bracket.includes('0-1')) updates.years_experience = 1;
						else if (bracket.includes('1-3')) updates.years_experience = 2;
						else if (bracket.includes('3-5')) updates.years_experience = 4;
						else if (bracket.includes('5-10')) updates.years_experience = 7;
						else if (bracket.includes('10+')) updates.years_experience = 12;
					} else if (q.category === 'work_authorization') {
						// Store as a profile note
					}
				}

				if (Object.keys(updates).length > 0) {
					const setClauses = [];
					const values = [req.user.id];
					let idx = 2;
					for (const [key, val] of Object.entries(updates)) {
						setClauses.push(`${key} = COALESCE($${idx}, ${key})`);
						values.push(val);
						idx++;
					}
					if (setClauses.length > 0) {
						await pool.query(
							`UPDATE candidate_profiles SET ${setClauses.join(', ')}, updated_at = NOW() WHERE user_id = $1`,
							values,
						);
					}
				}
			} catch (enrichErr) {
				console.error('Profile enrichment from screening (non-blocking):', enrichErr.message);
			}
		}

		// Auto-create conversation for recruiter-candidate chat (Issue #114 — non-blocking)
		try {
			const { getOrCreateConversation } = require('../routes/chat');
			await getOrCreateConversation(
				req.params.jobId,
				req.user.id,
				job.rows[0].user_id,
				job.rows[0].company_id,
			);
		} catch (convErr) {
			console.error('[apply] Auto-create conversation failed (non-blocking):', convErr.message);
		}

		res.json({ success: true, application: result.rows[0] });

		// ── Send application submitted notification to candidate (non-blocking) ──
		try {
			const jobInfo = job.rows[0];
			const userInfo = profile.rows[0];
			await emailService.sendTemplatedEmail({
				to: userInfo?.email,
				templateName: 'candidate_application_submitted',
				templateData: {
					name: userInfo?.name || 'Candidate',
					job_title: jobInfo?.title || 'the position',
					company_name: jobInfo?.company || 'Our Company',
					location: jobInfo?.location || 'Remote',
					applied_date: new Date().toISOString(),
					application_link: `${process.env.FRONTEND_URL || 'https://rekrutai.co'}/candidate/applications`,
				},
				userId: req.user.id,
				metadata: { job_id: jobInfo?.id, company_id: jobInfo?.company_id },
			});
		} catch (emailErr) {
			console.error(
				'[email] Failed to send application submitted email (non-blocking):',
				emailErr.message,
			);
		}

		// ── Send application received notification to recruiter (non-blocking) ──
		try {
			const jobInfo = job.rows[0];
			const userInfo = profile.rows[0];
			// Get recruiter email for this job
			const recruiterResult = await pool.query(
				'SELECT u.id, u.email, u.name FROM users u JOIN jobs j ON j.user_id = u.id WHERE j.id = $1',
				[req.params.jobId],
			);
			const recruiter = recruiterResult.rows[0];
			if (recruiter?.email) {
				await emailService.sendTemplatedEmail({
					to: recruiter.email,
					templateName: 'recruiter_new_application',
					templateData: {
						name: recruiter.name || 'Recruiter',
						candidate_name: userInfo?.name || 'Candidate',
						candidate_email: userInfo?.email || '',
						job_title: jobInfo?.title || 'the position',
						omniscore: omniscore || 'N/A',
						verification_status: 'verified',
						applied_date: new Date().toISOString(),
						application_link: `${process.env.FRONTEND_URL || 'https://rekrutai.co'}/recruiter/applications`,
					},
					userId: recruiter.id,
					metadata: { job_id: jobInfo?.id, candidate_id: req.user.id },
				});
			}
		} catch (emailErr) {
			console.error(
				'[email] Failed to send recruiter notification (non-blocking):',
				emailErr.message,
			);
		}
	} catch (err) {
		console.error('Apply to job error:', err);
		res.status(500).json({ error: 'Failed to apply to job' });
	}
});

// Get my applications
router.get('/applications', authMiddleware, async (req, res) => {
	try {
		const applications = await pool.query(
			`
      SELECT ja.*, ja.is_auto_applied, j.title, j.company, j.location, j.salary_range, j.job_type,
             j.screening_questions, u.company_name as posted_by_company,
             ri.status as intro_status, ri.id as intro_id,
             (SELECT COUNT(*) FROM outreach_attempts oa WHERE oa.application_id = ja.id) as outreach_count
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN users u ON j.user_id = u.id
      LEFT JOIN recruiter_introductions ri ON ri.job_id = ja.job_id AND ri.candidate_id = ja.candidate_id
      WHERE ja.candidate_id = $1
      ORDER BY ja.applied_at DESC
    `,
			[req.user.id],
		);

		res.json({ success: true, applications: applications.rows });
	} catch (err) {
		console.error('Get applications error:', err);
		res.status(500).json({ error: 'Failed to get applications' });
	}
});

// Auto-apply to a job (Pro feature, rate-limited)
router.post('/applications/auto-apply', authMiddleware, async (req, res) => {
	try {
		const { job_id } = req.body;
		if (!job_id) {
			return res.status(400).json({ error: 'job_id is required' });
		}

		// Check feature access and rate limits
		const access = await checkFeatureAccess(req.user, 'auto_apply');
		if (!access.allowed) {
			return res.status(403).json({
				error: 'Upgrade to Pro to access Auto-Apply',
				code: 'UPGRADE_REQUIRED',
				feature: 'auto_apply',
				upgradeUrl: '/pricing',
			});
		}

		// Check if already applied
		const existing = await pool.query(
			'SELECT id FROM job_applications WHERE candidate_id = $1 AND job_id = $2',
			[req.user.id, job_id],
		);
		if (existing.rows.length > 0) {
			return res.status(409).json({ error: 'You have already applied to this job' });
		}

		// Fetch job for company_id
		const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Fetch candidate profile for match_score / omniscore
		const profile = await pool.query(
			`
				SELECT cp.*, u.name, u.email, os.total_score as omniscore
				FROM users u
				LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
				LEFT JOIN omni_scores os ON os.user_id = u.id
				WHERE u.id = $1
			`,
			[req.user.id],
		);

		const skills = await pool.query('SELECT skill_name FROM candidate_skills WHERE user_id = $1', [
			req.user.id,
		]);

		const candidateProfile = {
			...profile.rows[0],
			skills: skills.rows,
		};

		// ponytail: reuse subscriptionId fetch pattern from manual apply
		const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
			req.user.id,
		]);
		const subscriptionId = user.rows[0]?.stripe_subscription_id;

		let matchScore = 50;
		try {
			const match = await generateJobMatchScore(candidateProfile, job.rows[0], { subscriptionId });
			matchScore = match.match_score;
		} catch (_e) {}

		const omniscore = profile.rows[0]?.omniscore || null;

		// Insert auto-application — no cover letter, no screening answers
		const result = await pool.query(
			`
				INSERT INTO job_applications (
					candidate_id, job_id, company_id,
					cover_letter, match_score, omniscore_at_apply,
					screening_answers, is_auto_applied
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				RETURNING *
			`,
			[
				req.user.id,
				job_id,
				job.rows[0].company_id,
				'', // ponytail: empty cover letter for auto-apply
				matchScore,
				omniscore,
				JSON.stringify({}), // ponytail: empty screening answers for auto-apply
				true,
			],
		);

		// Increment usage for rate limiting
		await incrementUsage(req.user.id, 'auto_apply');

		// ── Send application submitted notification to candidate (non-blocking) ──
		try {
			const jobInfo = job.rows[0];
			const userInfo = profile.rows[0];
			await emailService.sendTemplatedEmail({
				to: userInfo?.email,
				templateName: 'candidate_application_submitted',
				templateData: {
					name: userInfo?.name || 'Candidate',
					job_title: jobInfo?.title || 'the position',
					company_name: jobInfo?.company || 'Our Company',
					location: jobInfo?.location || 'Remote',
					applied_date: new Date().toISOString(),
					application_link: `${process.env.FRONTEND_URL || 'https://rekrutai.co'}/candidate/applications`,
				},
				userId: req.user.id,
				metadata: { job_id: jobInfo?.id, company_id: jobInfo?.company_id },
			});
		} catch (emailErr) {
			console.error(
				'[email] Failed to send auto-apply submitted email (non-blocking):',
				emailErr.message,
			);
		}

		// ── Send application received notification to recruiter (non-blocking) ──
		try {
			const jobInfo = job.rows[0];
			const userInfo = profile.rows[0];
			const recruiterResult = await pool.query(
				'SELECT u.id, u.email, u.name FROM users u JOIN jobs j ON j.user_id = u.id WHERE j.id = $1',
				[job_id],
			);
			const recruiter = recruiterResult.rows[0];
			if (recruiter?.email) {
				await emailService.sendTemplatedEmail({
					to: recruiter.email,
					templateName: 'recruiter_new_application',
					templateData: {
						name: recruiter.name || 'Recruiter',
						candidate_name: userInfo?.name || 'Candidate',
						candidate_email: userInfo?.email || '',
						job_title: jobInfo?.title || 'the position',
						omniscore: omniscore || 'N/A',
						verification_status: 'verified',
						applied_date: new Date().toISOString(),
						application_link: `${process.env.FRONTEND_URL || 'https://rekrutai.co'}/recruiter/applications`,
					},
					userId: recruiter.id,
					metadata: { job_id: jobInfo?.id, candidate_id: req.user.id },
				});
			}
		} catch (emailErr) {
			console.error(
				'[email] Failed to send recruiter notification for auto-apply (non-blocking):',
				emailErr.message,
			);
		}

		res.json({ success: true, application: result.rows[0] });
	} catch (err) {
		console.error('Auto-apply error:', err);
		res.status(500).json({ error: 'Failed to auto-apply to job' });
	}
});

// Withdraw an application
router.put('/applications/:id/withdraw', authMiddleware, async (req, res) => {
	try {
		// Verify application belongs to candidate and is withdrawable
		const existing = await pool.query(
			`SELECT id, status FROM job_applications WHERE id = $1 AND candidate_id = $2`,
			[req.params.id, req.user.id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const app = existing.rows[0];
		if (['withdrawn', 'hired', 'rejected'].includes(app.status)) {
			return res
				.status(400)
				.json({ error: `Cannot withdraw an application with status: ${app.status}` });
		}

		const result = await pool.query(
			`UPDATE job_applications SET status = 'withdrawn', updated_at = NOW() WHERE id = $1 RETURNING *`,
			[req.params.id],
		);

		res.json({ success: true, application: result.rows[0] });
	} catch (err) {
		console.error('Withdraw application error:', err);
		res.status(500).json({ error: 'Failed to withdraw application' });
	}
});

// Update application status
router.put('/applications/:id/status', authMiddleware, async (req, res) => {
	try {
		const { status } = req.body;
		const validStatuses = ['applied', 'screening', 'shortlisted', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn'];

		if (!status || !validStatuses.includes(status)) {
			return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
		}

		// Verify application belongs to candidate
		const existing = await pool.query(
			`SELECT id, status FROM job_applications WHERE id = $1 AND candidate_id = $2`,
			[req.params.id, req.user.id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const result = await pool.query(
			`UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
			[status, req.params.id],
		);

		res.json({ success: true, application: result.rows[0] });
	} catch (err) {
		console.error('Update application status error:', err);
		res.status(500).json({ error: 'Failed to update application status' });
	}
});

// ============= INTERVIEW COACHING =============

router.post('/coaching', authMiddleware, async (req, res) => {
	try {
		const { question, response, feedback } = req.body;

		const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [
			req.user.id,
		]);
		const subscriptionId = user.rows[0]?.stripe_subscription_id;

		const coaching = await generateInterviewCoaching(question, response, feedback, {
			subscriptionId,
		});

		res.json({ success: true, coaching });
	} catch (err) {
		console.error('Get coaching error:', err);
		res.status(500).json({ error: 'Failed to get coaching' });
	}
});

// ============= DASHBOARD STATS =============

router.get('/dashboard/stats', authMiddleware, async (req, res) => {
	try {
		// Get OmniScore
		const omniscore = await pool.query(
			'SELECT total_score, score_tier FROM omni_scores WHERE user_id = $1',
			[req.user.id],
		);

		// Get profile completeness
		const profile = await pool.query('SELECT * FROM candidate_profiles WHERE user_id = $1', [
			req.user.id,
		]);

		const skillCount = await pool.query(
			'SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE is_verified) as verified FROM candidate_skills WHERE user_id = $1',
			[req.user.id],
		);

		const experienceCount = await pool.query(
			'SELECT COUNT(*) as count FROM work_experience WHERE user_id = $1',
			[req.user.id],
		);

		const educationCount = await pool.query(
			'SELECT COUNT(*) as count FROM education WHERE user_id = $1',
			[req.user.id],
		);

		const interviewCount = await pool.query(
			"SELECT COUNT(*) as total, AVG(overall_score) as avg_score FROM interviews WHERE user_id = $1 AND status = 'completed'",
			[req.user.id],
		);

		const applicationCount = await pool.query(
			'SELECT COUNT(*) as count FROM job_applications WHERE candidate_id = $1',
			[req.user.id],
		);

		const savedJobCount = await pool.query(
			'SELECT COUNT(*) as count FROM saved_jobs WHERE user_id = $1',
			[req.user.id],
		);

		const assessmentCount = await pool.query(
			'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE passed) as passed FROM skill_assessments WHERE user_id = $1 AND completed_at IS NOT NULL',
			[req.user.id],
		);

		// Calculate profile completeness
		const p = profile.rows[0] || {};
		const completenessFields = [
			p.headline,
			p.bio,
			p.location,
			p.linkedin_url || p.github_url,
			parseInt(skillCount.rows[0]?.count, 10) > 0,
			parseInt(experienceCount.rows[0]?.count, 10) > 0,
		];
		const completeness = Math.round(
			(completenessFields.filter(Boolean).length / completenessFields.length) * 100,
		);

		res.json({
			success: true,
			stats: {
				omniscore: omniscore.rows[0] || { total_score: 300, score_tier: 'new' },
				profile_completeness: completeness,
				skills: {
					total: parseInt(skillCount.rows[0]?.count, 10) || 0,
					verified: parseInt(skillCount.rows[0]?.verified, 10) || 0,
				},
				experience_count: parseInt(experienceCount.rows[0]?.count, 10) || 0,
				education_count: parseInt(educationCount.rows[0]?.count, 10) || 0,
				interviews: {
					total: parseInt(interviewCount.rows[0]?.total, 10) || 0,
					avg_score: Math.round(interviewCount.rows[0]?.avg_score) || 0,
				},
				applications: parseInt(applicationCount.rows[0]?.count, 10) || 0,
				saved_jobs: parseInt(savedJobCount.rows[0]?.count, 10) || 0,
				assessments: {
					total: parseInt(assessmentCount.rows[0]?.total, 10) || 0,
					passed: parseInt(assessmentCount.rows[0]?.passed, 10) || 0,
				},
			},
		});
	} catch (err) {
		console.error('Get dashboard stats error:', err);
		res.status(500).json({ error: 'Failed to get dashboard stats' });
	}
});

// ============= SCHEDULED INTERVIEWS (from recruiters) =============

// Get all interviews for candidate (upcoming + past)
router.get('/interviews/scheduled', authMiddleware, async (req, res) => {
	try {
		const { status, upcoming_only } = req.query;

		let query = `
      SELECT
        si.id, si.scheduled_at, si.duration_minutes, si.interview_type,
        si.meeting_link, si.notes, si.status, si.outcome, si.feedback,
        si.created_at, si.updated_at,
        j.title as job_title, j.company as company_name, j.id as job_id,
        u.name as recruiter_name, u.email as recruiter_email,
        c.name as company_full_name
      FROM scheduled_interviews si
      JOIN jobs j ON si.job_id = j.id
      LEFT JOIN users u ON si.recruiter_id = u.id
      LEFT JOIN companies c ON si.company_id = c.id
      WHERE si.candidate_id = $1
    `;
		const params = [req.user.id];

		if (status) {
			query += ` AND si.status = $${params.length + 1}`;
			params.push(status);
		}

		if (upcoming_only === 'true') {
			query += ` AND si.scheduled_at > NOW() - INTERVAL '1 hour' AND si.status = 'scheduled'`;
		}

		query += ` ORDER BY si.scheduled_at DESC`;

		const interviews = await pool.query(query, params);

		res.json({ success: true, interviews: interviews.rows });
	} catch (err) {
		console.error('Get scheduled interviews error:', err);
		res.status(500).json({ error: 'Failed to get scheduled interviews' });
	}
});

// Accept an interview
router.put('/interviews/:id/accept', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`UPDATE scheduled_interviews
       SET status = 'confirmed', updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2 AND status = 'scheduled'
       RETURNING *`,
			[req.params.id, req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found or already responded' });
		}

		res.json({ success: true, interview: result.rows[0] });

		// ── Calendar auto-sync (non-blocking) ──
		try {
			await calendarService.syncInterview(result.rows[0], 'update');
		} catch (calErr) {
			console.error('[calendar] Auto-sync update failed (non-blocking):', calErr.message);
		}
	} catch (err) {
		console.error('Accept interview error:', err);
		res.status(500).json({ error: 'Failed to accept interview' });
	}
});

// Decline an interview
router.put('/interviews/:id/decline', authMiddleware, async (req, res) => {
	try {
		const { reason } = req.body;

		const result = await pool.query(
			`UPDATE scheduled_interviews
       SET status = 'cancelled', outcome = $3, updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2 AND status IN ('scheduled', 'confirmed')
       RETURNING *`,
			[req.params.id, req.user.id, reason || 'Candidate declined'],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found or cannot be declined' });
		}

		res.json({ success: true, interview: result.rows[0] });

		// ── Calendar auto-sync (non-blocking) ──
		try {
			await calendarService.syncInterview(result.rows[0], 'delete');
		} catch (calErr) {
			console.error('[calendar] Auto-sync delete failed (non-blocking):', calErr.message);
		}
	} catch (err) {
		console.error('Decline interview error:', err);
		res.status(500).json({ error: 'Failed to decline interview' });
	}
});

// Request reschedule
router.put('/interviews/:id/reschedule', authMiddleware, async (req, res) => {
	try {
		const { preferred_time, reason } = req.body;

		const result = await pool.query(
			`UPDATE scheduled_interviews
       SET status = 'reschedule_requested',
           notes = COALESCE(notes, '') || E'\n[Reschedule request] ' || COALESCE($3, 'Candidate requested reschedule') || COALESCE(' - Preferred: ' || $4, ''),
           updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2 AND status IN ('scheduled', 'confirmed')
       RETURNING *`,
			[req.params.id, req.user.id, reason, preferred_time],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found or cannot be rescheduled' });
		}

		res.json({ success: true, interview: result.rows[0] });

		// ── Calendar auto-sync (non-blocking) ──
		try {
			await calendarService.syncInterview(result.rows[0], 'update');
		} catch (calErr) {
			console.error('[calendar] Auto-sync update failed (non-blocking):', calErr.message);
		}
	} catch (err) {
		console.error('Reschedule interview error:', err);
		res.status(500).json({ error: 'Failed to request reschedule' });
	}
});

// ============= AI FEATURES =============

// AI Resume Optimizer — tailored suggestions for a specific job (RATE LIMITED)
router.post('/ai/resume-optimizer', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { job_id } = req.body;
		const { chat } = require('../lib/polsia-ai');

		// Get candidate profile
		const profile = await pool.query(
			`
      SELECT cp.*, u.name, u.email FROM candidate_profiles cp
      RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1
    `,
			[req.user.id],
		);
		const skills = await pool.query(
			'SELECT skill_name, category, years_experience FROM candidate_skills WHERE user_id = $1',
			[req.user.id],
		);
		const experience = await pool.query(
			'SELECT company_name, title, description, achievements, skills_used FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC',
			[req.user.id],
		);
		const education = await pool.query(
			'SELECT institution, degree, field_of_study FROM education WHERE user_id = $1',
			[req.user.id],
		);

		let jobContext = '';
		if (job_id) {
			const job = await pool.query(
				'SELECT title, description, requirements FROM jobs WHERE id = $1',
				[job_id],
			);
			if (job.rows[0]) {
				jobContext = `\nTARGET JOB:\nTitle: ${job.rows[0].title}\nDescription: ${job.rows[0].description?.substring(0, 500)}\nRequirements: ${job.rows[0].requirements?.substring(0, 500)}`;
			}
		}

		const prompt = `Analyze this candidate's profile and provide specific resume optimization suggestions${job_id ? ' tailored to the target job' : ''}.

CANDIDATE:
Name: ${profile.rows[0]?.name}
Skills: ${skills.rows.map((s) => `${s.skill_name} (${s.years_experience || '?'}y)`).join(', ') || 'None listed'}
Experience: ${experience.rows.map((e) => `${e.title} at ${e.company_name}`).join('; ') || 'None listed'}
Education: ${education.rows.map((e) => `${e.degree} from ${e.institution}`).join('; ') || 'None listed'}
Headline: ${profile.rows[0]?.headline || 'Not set'}
Bio: ${profile.rows[0]?.bio || 'Not set'}
${jobContext}

Return JSON:
{
  "overall_score": 0-100,
  "headline_suggestion": "Improved headline",
  "bio_suggestion": "Improved 2-3 sentence professional summary",
  "skill_gaps": ["Skills to add based on job requirements"],
  "keyword_suggestions": ["Important keywords missing from profile"],
  "experience_tips": ["Specific tip for improving experience descriptions"],
  "strengths": ["What's working well"],
  "priority_actions": ["Top 3 things to do immediately"]
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are an expert resume coach and ATS optimization specialist. Be specific and actionable. Always return valid JSON.',
			module: 'resume_tools',
			feature: 'resume_optimization',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' };
		}
		res.json({ success: true, optimization: parsed });
	} catch (err) {
		console.error('AI resume optimizer error:', err);
		res.status(500).json({ error: 'Failed to optimize resume' });
	}
});

// AI Cover Letter Generator — creates a tailored cover letter (RATE LIMITED)
router.post('/ai/cover-letter', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { job_id } = req.body;
		if (!job_id) return res.status(400).json({ error: 'job_id required' });
		const { chat } = require('../lib/polsia-ai');

		const profile = await pool.query(
			`
      SELECT cp.*, u.name, u.email FROM candidate_profiles cp
      RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1
    `,
			[req.user.id],
		);
		const skills = await pool.query(
			'SELECT skill_name, years_experience FROM candidate_skills WHERE user_id = $1',
			[req.user.id],
		);
		const experience = await pool.query(
			'SELECT company_name, title, description FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3',
			[req.user.id],
		);
		const job = await pool.query(
			'SELECT title, company, description, requirements FROM jobs WHERE id = $1',
			[job_id],
		);

		if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });

		const prompt = `Write a compelling, professional cover letter for this candidate applying to this job.

CANDIDATE:
Name: ${profile.rows[0]?.name}
Skills: ${skills.rows.map((s) => `${s.skill_name} (${s.years_experience || '?'}y)`).join(', ')}
Recent Experience: ${experience.rows.map((e) => `${e.title} at ${e.company_name}: ${e.description?.substring(0, 200)}`).join('\n')}

JOB:
Title: ${job.rows[0].title} at ${job.rows[0].company}
Description: ${job.rows[0].description?.substring(0, 800)}
Requirements: ${job.rows[0].requirements?.substring(0, 500)}

Return JSON:
{
  "cover_letter": "The full cover letter text (3-4 paragraphs, professional tone)",
  "key_highlights": ["3 key strengths emphasized"],
  "match_score": 0-100
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are an expert career coach writing compelling cover letters. Be authentic, specific, and persuasive. Never use generic filler. Always return valid JSON.',
			module: 'resume_tools',
			feature: 'cover_letter',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' };
		}
		res.json({ success: true, ...parsed });
	} catch (err) {
		console.error('AI cover letter error:', err);
		res.status(500).json({ error: 'Failed to generate cover letter' });
	}
});

// AI Screening Answer Suggestions — based on stored profile and past answers (RATE LIMITED)
router.post('/ai/screening-suggestions', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { questions } = req.body;
		if (!questions || !Array.isArray(questions))
			return res.status(400).json({ error: 'questions array required' });
		const { chat } = require('../lib/polsia-ai');

		// Get profile data
		const profile = await pool.query(
			`SELECT cp.*, u.name FROM candidate_profiles cp RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1`,
			[req.user.id],
		);
		const skills = await pool.query(
			'SELECT skill_name, years_experience FROM candidate_skills WHERE user_id = $1',
			[req.user.id],
		);
		const experience = await pool.query(
			'SELECT title, company_name FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3',
			[req.user.id],
		);

		// Get past screening answers
		const pastAnswers = await pool.query(
			`
      SELECT ja.screening_answers FROM job_applications ja WHERE ja.candidate_id = $1 AND ja.screening_answers IS NOT NULL
      ORDER BY ja.applied_at DESC LIMIT 5
    `,
			[req.user.id],
		);

		const pastData = pastAnswers.rows.map((r) => r.screening_answers).filter(Boolean);

		const prompt = `Suggest answers to these screening questions based on the candidate's profile and past answers.

CANDIDATE:
Name: ${profile.rows[0]?.name}
Skills: ${skills.rows.map((s) => `${s.skill_name} (${s.years_experience || '?'}y)`).join(', ')}
Experience: ${experience.rows.map((e) => `${e.title} at ${e.company_name}`).join('; ')}
Location: ${profile.rows[0]?.location || 'Not specified'}
Salary preference: ${profile.rows[0]?.salary_min ? `$${profile.rows[0].salary_min}-$${profile.rows[0].salary_max}` : 'Not specified'}
Availability: ${profile.rows[0]?.availability || 'Not specified'}

PAST ANSWERS (for reuse):
${JSON.stringify(pastData).substring(0, 1000)}

QUESTIONS TO ANSWER:
${questions.map((q, i) => `${i + 1}. [${q.type}] ${q.question} ${q.options ? `(Options: ${q.options.join(', ')})` : ''}`).join('\n')}

Return JSON array:
[
  {
    "question_id": "original question id",
    "suggested_answer": "The suggested answer",
    "source": "profile|past_answer|inferred",
    "confidence": "high|medium|low"
  }
]
Only return JSON array.`;

		const result = await chat(prompt, {
			system:
				'You are a career assistant helping candidates fill out screening questions. Use their actual profile data. Be truthful - never fabricate information. Always return valid JSON.',
			module: 'screening',
			feature: 'auto_fill',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\[[\s\S]*\]/);
			parsed = m ? JSON.parse(m[0]) : [];
		}
		res.json({ success: true, suggestions: parsed });
	} catch (err) {
		console.error('AI screening suggestions error:', err);
		res.status(500).json({ error: 'Failed to generate suggestions' });
	}
});

// ============= SMART DATA REUSE =============

// Auto-fill endpoint — returns stored data for pre-populating application forms
router.get('/auto-fill/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = req.params.jobId;

		// Get profile data
		const profile = await pool.query(
			`
      SELECT cp.*, u.name, u.email FROM candidate_profiles cp
      RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1
    `,
			[req.user.id],
		);

		// Get resume URL
		const resumeData = await pool.query(
			'SELECT resume_url FROM candidate_profiles WHERE user_id = $1',
			[req.user.id],
		);

		// Get screening questions for this job
		const job = await pool.query('SELECT screening_questions FROM jobs WHERE id = $1', [jobId]);
		const screeningQuestions = job.rows[0]?.screening_questions || [];

		// Find past answers for similar questions
		const pastApps = await pool.query(
			`
      SELECT screening_answers, cover_letter FROM job_applications
      WHERE candidate_id = $1 AND screening_answers IS NOT NULL
      ORDER BY applied_at DESC LIMIT 10
    `,
			[req.user.id],
		);

		// Build auto-fill map for screening questions
		const answerMap = {};
		for (const q of screeningQuestions) {
			// Search past answers by category or similar question text
			for (const app of pastApps.rows) {
				const answers = app.screening_answers || {};
				// Direct ID match
				if (answers[q.id]) {
					answerMap[q.id] = { value: answers[q.id], source: 'previous_application' };
					break;
				}
				// Category match
				for (const [key, val] of Object.entries(answers)) {
					if (q.category && key.includes(q.category)) {
						answerMap[q.id] = { value: val, source: 'similar_question' };
						break;
					}
				}
			}

			// Fallback: match from profile data
			if (!answerMap[q.id] && q.category) {
				const p = profile.rows[0] || {};
				if (q.category === 'salary' && p.salary_min) {
					answerMap[q.id] = {
						value: `$${p.salary_min.toLocaleString()} - $${(p.salary_max || p.salary_min).toLocaleString()}`,
						source: 'profile',
					};
				} else if (q.category === 'availability' && p.availability) {
					answerMap[q.id] = { value: p.availability, source: 'profile' };
				} else if (q.category === 'relocation') {
					answerMap[q.id] = {
						value: p.remote_preference === 'remote' ? 'No' : 'Yes',
						source: 'profile',
					};
				} else if (q.category === 'experience') {
					const yrs = p.years_experience || 0;
					const bracket =
						yrs < 1
							? '0-1 years'
							: yrs < 3
								? '1-3 years'
								: yrs < 5
									? '3-5 years'
									: yrs < 10
										? '5-10 years'
										: '10+ years';
					answerMap[q.id] = { value: bracket, source: 'profile' };
				}
			}
		}

		// Find the most recent cover letter
		const lastCoverLetter = pastApps.rows.find((a) => a.cover_letter)?.cover_letter || '';

		res.json({
			success: true,
			auto_fill: {
				resume_url: resumeData.rows[0]?.resume_url || null,
				cover_letter: lastCoverLetter,
				screening_answers: answerMap,
				profile: {
					name: profile.rows[0]?.name,
					email: profile.rows[0]?.email,
					phone: profile.rows[0]?.phone,
					location: profile.rows[0]?.location,
				},
			},
		});
	} catch (err) {
		console.error('Auto-fill error:', err);
		res.status(500).json({ error: 'Failed to get auto-fill data' });
	}
});

// ============= OFFERS (Candidate side) =============

// Get my offers
router.get('/offers', authMiddleware, async (req, res) => {
	try {
		const offers = await pool.query(
			`
      SELECT o.*,
             j.title as job_title, j.company as company_name, j.location as job_location,
             u.name as recruiter_name
      FROM offers o
      JOIN jobs j ON o.job_id = j.id
      LEFT JOIN users u ON o.recruiter_id = u.id
      WHERE o.candidate_id = $1 AND o.status != 'draft'
      ORDER BY o.sent_at DESC NULLS LAST, o.created_at DESC
    `,
			[req.user.id],
		);

		res.json({ success: true, offers: offers.rows });
	} catch (err) {
		console.error('Get offers error:', err);
		res.status(500).json({ error: 'Failed to get offers' });
	}
});

// View single offer (marks as viewed)
router.get('/offers/:id', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			`
      SELECT o.*,
             j.title as job_title, j.company as company_name, j.description as job_description,
             j.location as job_location, j.job_type,
             u.name as recruiter_name, u.email as recruiter_email
      FROM offers o
      JOIN jobs j ON o.job_id = j.id
      LEFT JOIN users u ON o.recruiter_id = u.id
      WHERE o.id = $1 AND o.candidate_id = $2 AND o.status != 'draft'
    `,
			[req.params.id, req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}

		// Mark as viewed if not already
		if (!result.rows[0].viewed_at) {
			await pool.query('UPDATE offers SET viewed_at = NOW() WHERE id = $1', [req.params.id]);
			result.rows[0].viewed_at = new Date();
		}

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Get offer error:', err);
		res.status(500).json({ error: 'Failed to get offer' });
	}
});

// Accept offer
router.put('/offers/:id/accept', authMiddleware, async (req, res) => {
	try {
		const existing = await pool.query(
			'SELECT id, status, job_id FROM offers WHERE id = $1 AND candidate_id = $2',
			[req.params.id, req.user.id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}
		if (existing.rows[0].status !== 'sent') {
			return res
				.status(400)
				.json({ error: `Cannot accept offer with status: ${existing.rows[0].status}` });
		}

		const result = await pool.query(
			`UPDATE offers SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
			[req.params.id],
		);

		// Update application status to 'hired'
		await pool.query(
			`UPDATE job_applications SET status = 'hired', updated_at = NOW()
       WHERE job_id = $1 AND candidate_id = $2`,
			[existing.rows[0].job_id, req.user.id],
		);

		// Update job analytics
		try {
			await pool.query(
				'UPDATE job_analytics SET offers_accepted = COALESCE(offers_accepted, 0) + 1 WHERE job_id = $1',
				[existing.rows[0].job_id],
			);
		} catch (_e) {
			/* non-critical */
		}

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Accept offer error:', err);
		res.status(500).json({ error: 'Failed to accept offer' });
	}
});

// Decline offer
router.put('/offers/:id/decline', authMiddleware, async (req, res) => {
	try {
		const { reason } = req.body;

		const existing = await pool.query(
			'SELECT id, status FROM offers WHERE id = $1 AND candidate_id = $2',
			[req.params.id, req.user.id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}
		if (existing.rows[0].status !== 'sent') {
			return res
				.status(400)
				.json({ error: `Cannot decline offer with status: ${existing.rows[0].status}` });
		}

		const result = await pool.query(
			`UPDATE offers SET status = 'declined', declined_at = NOW(), decline_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
			[req.params.id, reason || null],
		);

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Decline offer error:', err);
		res.status(500).json({ error: 'Failed to decline offer' });
	}
});

// ============= AI AGENT ENDPOINTS (Phase 4) =============

// AI Match Explanation — natural language explanation of why a job matches (RATE LIMITED)
router.post('/ai/match-explanation', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { job_id } = req.body;
		if (!job_id) return res.status(400).json({ error: 'job_id required' });
		const { chat } = require('../lib/polsia-ai');

		// Get match data from match_results (already calculated by matching engine)
		const matchData = await pool.query(
			`
      SELECT mr.*, j.title, j.company, j.requirements, j.description, j.location, j.salary_range
      FROM match_results mr
      JOIN jobs j ON j.id = mr.job_id
      WHERE mr.candidate_id = $1 AND mr.job_id = $2
    `,
			[req.user.id, job_id],
		);

		// Get candidate profile for context
		const profile = await pool.query(
			`SELECT cp.*, u.name FROM candidate_profiles cp RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1`,
			[req.user.id],
		);
		const skills = await pool.query(
			'SELECT skill_name, level FROM candidate_skills WHERE user_id = $1',
			[req.user.id],
		);

		const match = matchData.rows[0];
		const p = profile.rows[0] || {};

		const prompt = `Generate a clear, encouraging explanation of why this job is a match for this candidate. Use the dimensional scores to explain each aspect.

CANDIDATE: ${p.name || 'Candidate'}
Skills: ${skills.rows.map((s) => s.skill_name).join(', ') || 'Not listed'}
Experience: ${p.years_experience || '?'} years
Location: ${p.location || 'Not specified'}
Salary preference: ${p.salary_min ? `$${p.salary_min}-$${p.salary_max}` : 'Not specified'}

JOB: ${match?.title || 'Unknown'} at ${match?.company || 'Unknown'}
Location: ${match?.location || 'N/A'}
Salary: ${match?.salary_range || 'N/A'}
Requirements: ${match?.requirements?.substring(0, 400) || 'N/A'}

MATCH DATA:
Weighted Score: ${match?.weighted_score || 'N/A'}
Similarity Score: ${match?.similarity_score || 'N/A'}
Matching Skills: ${JSON.stringify(match?.matching_skills || [])}
Missing Skills: ${JSON.stringify(match?.missing_skills || [])}
Match Explanation: ${JSON.stringify(match?.match_explanation || {})}

Return JSON:
{
  "explanation": "2-3 sentences in natural language explaining why this is a match",
  "match_level": "excellent|good|fair|poor",
  "dimensions": {
    "skills": { "score": 0-100, "detail": "brief explanation" },
    "experience": { "score": 0-100, "detail": "brief explanation" },
    "location": { "score": 0-100, "detail": "brief explanation" },
    "salary": { "score": 0-100, "detail": "brief explanation" },
    "culture": { "score": 0-100, "detail": "brief explanation" }
  },
  "skill_gaps": ["skills to develop for this role"],
  "action_items": ["1-2 things candidate can do to strengthen their application"]
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are a career advisor providing personalized, actionable job match explanations. Be encouraging but honest. Always return valid JSON.',
			module: 'matching',
			feature: 'match_explanation',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m
				? JSON.parse(m[0])
				: { explanation: 'Match analysis unavailable', match_level: 'fair', dimensions: {} };
		}
		res.json({ success: true, ...parsed });
	} catch (err) {
		console.error('AI match explanation error:', err);
		res.status(500).json({ error: 'Failed to generate match explanation' });
	}
});

// AI Smart Search — intent-based natural language job search (RATE LIMITED)
router.post('/ai/smart-search', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { query } = req.body;
		if (!query || query.trim().length < 3)
			return res.status(400).json({ error: 'Search query required (min 3 chars)' });
		const { chat } = require('../lib/polsia-ai');

		// Step 1: Parse the natural language query into structured filters
		const parsePrompt = `Parse this job search query into structured filters.

Query: "${query}"

Return JSON:
{
  "keywords": ["keyword1", "keyword2"],
  "job_type": "full-time|part-time|contract|remote|null",
  "location": "city or remote or null",
  "min_salary": null or number,
  "skills": ["skill1", "skill2"],
  "experience_level": "entry|mid|senior|lead|null",
  "industry": "tech|finance|healthcare|null"
}
Only return JSON.`;

		const parseResult = await chat(parsePrompt, {
			system:
				'You are a search query parser. Extract structured filters from natural language job search queries. Always return valid JSON.',
			module: 'smart_search',
			feature: 'query_parsing',
		});

		let filters;
		try {
			filters = JSON.parse(parseResult);
		} catch {
			const m = parseResult.match(/\{[\s\S]*\}/);
			filters = m ? JSON.parse(m[0]) : { keywords: query.split(' ') };
		}

		// Step 2: Build SQL query based on parsed filters
		const sqlParts = [`j.status = 'active'`];
		const params = [];
		let paramIdx = 1;

		// Keyword search across title, description, requirements
		if (filters.keywords && filters.keywords.length > 0) {
			const keywordClauses = filters.keywords.map((kw) => {
				params.push(`%${kw}%`);
				const idx = paramIdx++;
				return `(j.title ILIKE $${idx} OR j.description ILIKE $${idx} OR j.requirements ILIKE $${idx})`;
			});
			sqlParts.push(`(${keywordClauses.join(' OR ')})`);
		}

		// Job type filter
		if (filters.job_type && filters.job_type !== 'null') {
			if (filters.job_type === 'remote') {
				params.push('%remote%');
				sqlParts.push(`(j.location ILIKE $${paramIdx++} OR j.job_type = 'remote')`);
			} else {
				params.push(filters.job_type);
				sqlParts.push(`j.job_type = $${paramIdx++}`);
			}
		}

		// Location filter
		if (filters.location && filters.location !== 'null' && filters.location !== 'remote') {
			params.push(`%${filters.location}%`);
			sqlParts.push(`j.location ILIKE $${paramIdx++}`);
		}

		const sqlQuery = `
      SELECT j.*, u.company_name as posted_by_company,
             (SELECT COUNT(*) FROM job_applications WHERE job_id = j.id) as applicant_count
      FROM jobs j
      LEFT JOIN users u ON j.user_id = u.id
      WHERE ${sqlParts.join(' AND ')}
      ORDER BY j.created_at DESC
      LIMIT 20
    `;

		const jobs = await pool.query(sqlQuery, params);

		// Step 3: Score results for the current user if authenticated
		let scoredJobs = jobs.rows;
		if (req.user?.id) {
			const userSkills = await pool.query(
				'SELECT skill_name FROM candidate_skills WHERE user_id = $1',
				[req.user.id],
			);
			const candidateSkillNames = userSkills.rows.map((s) => s.skill_name.toLowerCase());

			scoredJobs = jobs.rows.map((job) => {
				const reqText = (job.requirements || '').toLowerCase();
				const matchCount = candidateSkillNames.filter((s) => reqText.includes(s)).length;
				const relevance =
					candidateSkillNames.length > 0
						? Math.round((matchCount / candidateSkillNames.length) * 100)
						: 50;
				return { ...job, relevance_score: relevance };
			});

			scoredJobs.sort((a, b) => b.relevance_score - a.relevance_score);
		}

		res.json({
			success: true,
			query: query,
			parsed_filters: filters,
			jobs: scoredJobs,
			results: scoredJobs,
			total: scoredJobs.length,
		});
	} catch (err) {
		console.error('AI smart search error:', err);
		res.status(500).json({ error: 'Failed to perform smart search' });
	}
});

// AI Application Review — checks completeness before submit (RATE LIMITED)
router.post('/ai/application-review', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { job_id, cover_letter, screening_answers } = req.body;
		if (!job_id) return res.status(400).json({ error: 'job_id required' });
		const { chat } = require('../lib/polsia-ai');

		// Get job details
		const job = await pool.query(
			'SELECT title, description, requirements, screening_questions FROM jobs WHERE id = $1',
			[job_id],
		);
		if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });

		// Get candidate profile
		const profile = await pool.query(
			`SELECT cp.*, u.name FROM candidate_profiles cp RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1`,
			[req.user.id],
		);
		const skills = await pool.query('SELECT skill_name FROM candidate_skills WHERE user_id = $1', [
			req.user.id,
		]);
		const experience = await pool.query(
			'SELECT title, company_name FROM work_experience WHERE user_id = $1 LIMIT 5',
			[req.user.id],
		);

		const p = profile.rows[0] || {};
		const screeningQs = job.rows[0].screening_questions || [];
		const answeredCount = screening_answers
			? Object.keys(screening_answers).filter((k) => screening_answers[k]).length
			: 0;
		const requiredCount = screeningQs.filter((q) => q.required).length;

		const prompt = `Review this job application for completeness and quality. Identify issues BEFORE the candidate submits.

CANDIDATE PROFILE:
Name: ${p.name || 'Not set'}
Headline: ${p.headline || 'Not set'}
Skills: ${skills.rows.map((s) => s.skill_name).join(', ') || 'None listed'}
Experience: ${experience.rows.map((e) => `${e.title} at ${e.company_name}`).join('; ') || 'None listed'}
Resume: ${p.resume_url ? 'Uploaded' : 'NOT uploaded'}

APPLICATION:
Job: ${job.rows[0].title}
Cover Letter: ${cover_letter ? `${cover_letter.length} chars - "${cover_letter.substring(0, 200)}"` : 'NOT provided'}
Screening Questions: ${answeredCount}/${screeningQs.length} answered (${requiredCount} required)
Unanswered Required: ${
			screeningQs
				.filter((q) => q.required && !screening_answers?.[q.id])
				.map((q) => q.question)
				.join('; ') || 'None'
		}

Return JSON:
{
  "ready_to_submit": true/false,
  "completeness_score": 0-100,
  "issues": [
    { "severity": "critical|warning|tip", "message": "What's wrong", "fix": "How to fix it" }
  ],
  "strengths": ["What looks good about this application"],
  "suggestions": ["Quick improvements before submitting"]
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are an application review assistant. Be thorough but encouraging. Flag real issues, not nitpicks. Always return valid JSON.',
			module: 'application_review',
			feature: 'review',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m
				? JSON.parse(m[0])
				: {
						ready_to_submit: true,
						completeness_score: 50,
						issues: [],
						strengths: [],
						suggestions: [],
					};
		}
		res.json({ success: true, review: parsed });
	} catch (err) {
		console.error('AI application review error:', err);
		res.status(500).json({ error: 'Failed to review application' });
	}
});

// AI Resume Score — rate resume quality and feed into OmniScore (RATE LIMITED)
router.post('/ai/resume-score', authMiddleware, rateLimits.ai, async (req, res) => {
	try {
		const { chat } = require('../lib/polsia-ai');
		const omniscoreService = require('../services/omniscore');

		// Get candidate profile + resume
		const profile = await pool.query(
			`SELECT cp.*, u.name FROM candidate_profiles cp RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1`,
			[req.user.id],
		);
		const skills = await pool.query(
			'SELECT skill_name, level, is_verified FROM candidate_skills WHERE user_id = $1',
			[req.user.id],
		);
		const experience = await pool.query(
			'SELECT company_name, title, description, achievements FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC',
			[req.user.id],
		);
		const education = await pool.query(
			'SELECT institution, degree, field_of_study FROM education WHERE user_id = $1',
			[req.user.id],
		);

		const p = profile.rows[0] || {};

		const prompt = `Score this candidate's resume/profile quality on a 0-100 scale. Evaluate completeness, clarity, and professional impact.

PROFILE:
Name: ${p.name || 'Not set'}
Headline: ${p.headline || 'NOT set'}
Bio: ${p.bio || 'NOT set'}
Location: ${p.location || 'NOT set'}
Years Experience: ${p.years_experience || 'NOT set'}
Resume File: ${p.resume_url ? 'Uploaded' : 'NOT uploaded'}
LinkedIn: ${p.linkedin_url ? 'Linked' : 'NOT linked'}
GitHub: ${p.github_url ? 'Linked' : 'NOT linked'}

SKILLS (${skills.rows.length}):
${skills.rows.map((s) => `${s.skill_name} (L${s.level}${s.is_verified ? ' ✓' : ''})`).join(', ') || 'None'}

EXPERIENCE (${experience.rows.length}):
${experience.rows.map((e) => `${e.title} at ${e.company_name}${e.description ? ` - ${e.description.substring(0, 100)}` : ''}`).join('\n') || 'None'}

EDUCATION (${education.rows.length}):
${education.rows.map((e) => `${e.degree || ''} ${e.field_of_study || ''} from ${e.institution}`).join('\n') || 'None'}

Return JSON:
{
  "overall_score": 0-100,
  "sections": {
    "completeness": { "score": 0-100, "feedback": "..." },
    "clarity": { "score": 0-100, "feedback": "..." },
    "impact": { "score": 0-100, "feedback": "..." },
    "keywords": { "score": 0-100, "feedback": "..." }
  },
  "top_improvements": ["Top 3 things to improve"],
  "ats_friendly": true/false,
  "estimated_rank": "top_10|top_25|top_50|bottom_50"
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are a resume quality scoring engine. Be objective and data-driven. Score based on real criteria used by ATS systems and hiring managers. Always return valid JSON.',
			module: 'omniscore',
			feature: 'resume_score',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m
				? JSON.parse(m[0])
				: { overall_score: 50, sections: {}, top_improvements: [], ats_friendly: false };
		}

		// Feed resume score into OmniScore
		try {
			const resumePoints = Math.round((parsed.overall_score / 100) * 40); // Max 40 points for resume quality
			await pool.query(
				`
        INSERT INTO score_components (user_id, component_type, source_type, points, max_points, metadata)
        VALUES ($1, 'resume', 'ai_score', $2, 40, $3)
        ON CONFLICT (user_id, component_type, source_type) WHERE source_type = 'ai_score'
        DO UPDATE SET points = $2, metadata = $3, created_at = NOW()
      `,
				[req.user.id, resumePoints, JSON.stringify({ ai_score: parsed.overall_score })],
			);

			// Recalculate OmniScore
			await omniscoreService.calculateScore(req.user.id);
		} catch (scoreErr) {
			console.error('OmniScore update from resume score (non-fatal):', scoreErr.message);
		}

		res.json({ success: true, score: parsed });
	} catch (err) {
		console.error('AI resume score error:', err);
		res.status(500).json({ error: 'Failed to score resume' });
	}
});

// ============= LINKEDIN IMPORT =============

// POST /linkedin/import — Import LinkedIn profile data for candidate
router.post('/linkedin/import', authMiddleware, requireRole('candidate'), rateLimits.standard, async (req, res) => {
	try {
		// 1. Find the user's LinkedIn OAuth connection
		const connectionResult = await pool.query(
			`SELECT access_token, profile_data
			 FROM oauth_connections
			 WHERE user_id = $1 AND provider = 'linkedin'
			 ORDER BY updated_at DESC
			 LIMIT 1`,
			[req.user.id],
		);

		if (connectionResult.rows.length === 0) {
			return res.status(404).json({
				error: 'LinkedIn account not connected',
				code: 'LINKEDIN_NOT_CONNECTED',
			});
		}

		const { access_token: encryptedToken, profile_data: storedProfileData } = connectionResult.rows[0];

		if (!encryptedToken) {
			return res.status(404).json({
				error: 'LinkedIn token not found',
				code: 'LINKEDIN_TOKEN_MISSING',
			});
		}

		// 2. Decrypt the access token
		let accessToken;
		try {
			accessToken = decrypt(encryptedToken);
		} catch (decryptErr) {
			console.error('[linkedin/import] Token decryption failed:', decryptErr.message);
			return res.status(500).json({
				error: 'Failed to decrypt LinkedIn token',
				code: 'TOKEN_DECRYPTION_FAILED',
			});
		}

		if (!accessToken) {
			return res.status(404).json({
				error: 'LinkedIn token not found',
				code: 'LINKEDIN_TOKEN_MISSING',
			});
		}

		// 3. Call LinkedIn /v2/userinfo
		const userInfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		// Handle token expiration (401 from LinkedIn)
		if (userInfoResponse.status === 401) {
			return res.status(401).json({
				error: 'LinkedIn token expired. Please reconnect your account.',
				code: 'LINKEDIN_TOKEN_EXPIRED',
			});
		}

		if (!userInfoResponse.ok) {
			const errorBody = await userInfoResponse.text();
			console.error(`[linkedin/import] LinkedIn API error ${userInfoResponse.status}:`, errorBody);
			return res.status(502).json({
				error: 'LinkedIn API request failed',
				code: 'LINKEDIN_API_ERROR',
				status: userInfoResponse.status,
			});
		}

		const linkedinUser = await userInfoResponse.json();

		if (!linkedinUser.email) {
			return res.status(502).json({
				error: 'Could not retrieve email from LinkedIn',
				code: 'LINKEDIN_EMAIL_MISSING',
			});
		}

		// 4. Construct linkedin_url if possible
		let linkedinUrl = null;
		// Try to extract vanity name from stored profile_data if available
		if (storedProfileData) {
			try {
				const parsed = typeof storedProfileData === 'string' ? JSON.parse(storedProfileData) : storedProfileData;
				if (parsed.vanityName) {
					linkedinUrl = `https://www.linkedin.com/in/${parsed.vanityName}`;
				}
			} catch (_e) {
				// ignore parse errors
			}
		}
		// Fallback: try to construct from name (best effort)
		if (!linkedinUrl && linkedinUser.name) {
			const vanity = linkedinUser.name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '');
			if (vanity) {
				linkedinUrl = `https://www.linkedin.com/in/${vanity}`;
			}
		}

		const photo = linkedinUser.picture || null;
		const name = linkedinUser.name || `${linkedinUser.given_name || ''} ${linkedinUser.family_name || ''}`.trim() || null;

		// 5. Update users.avatar_url if photo changed
		if (photo && photo !== req.user.avatar_url) {
			try {
				await pool.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [
					photo,
					req.user.id,
				]);
			} catch (avatarErr) {
				console.error('[linkedin/import] Failed to update avatar_url (non-blocking):', avatarErr.message);
			}
		}

		res.json({
			success: true,
			name,
			email: linkedinUser.email,
			photo,
			linkedin_url: linkedinUrl,
		});
	} catch (err) {
		console.error('[linkedin/import] Error:', err.message, err.code, err.stack);
		res.status(500).json({ error: 'Failed to import LinkedIn profile' });
	}
});

// GET /api/candidate/list — returns candidates for the recruiter's company (Issue #109)
router.get('/list', authMiddleware, async (req, res) => {
	try {
		// Only recruiters/hiring managers can access this
		const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Recruiter access required' });
		}

		const companyId = req.user.company_id;
		if (!companyId) {
			return res.status(403).json({ error: 'No company associated' });
		}

		const result = await pool.query(
			`SELECT DISTINCT ON (u.id)
				u.id,
				u.name,
				u.email
			FROM job_applications ja
			JOIN users u ON ja.candidate_id = u.id
			WHERE ja.company_id = $1
			ORDER BY u.id, ja.applied_at DESC
			LIMIT 200`,
			[companyId],
		);

		res.json(result.rows);
	} catch (err) {
		console.error('Get candidate list error:', err);
		res.status(500).json({ error: 'Failed to fetch candidates' });
	}
});

// GET /api/candidate/documents — returns documents for the authenticated candidate (Issue #109)
router.get('/documents', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;

		// Graceful: create table if it doesn't exist
		await pool.query(`
			CREATE TABLE IF NOT EXISTS documents (
				id SERIAL PRIMARY KEY,
				user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
				name VARCHAR(500) NOT NULL,
				type VARCHAR(50) DEFAULT 'other',
				url TEXT,
				size INTEGER DEFAULT 0,
				status VARCHAR(50) DEFAULT 'pending',
				fraud_score NUMERIC(3,2),
				oer_text TEXT,
				oer_confidence NUMERIC(4,3),
				document_score INTEGER,
				verification_details JSONB DEFAULT '{}',
				created_at TIMESTAMP DEFAULT NOW()
			)
		`);

		const result = await pool.query(
			`SELECT
				id,
				name,
				type,
				url,
				size,
				status,
				fraud_score as fraudScore,
				oer_text as ocrText,
				oer_confidence as ocrConfidence,
				document_score as documentScore,
				verification_details as verificationDetails,
				created_at as uploadedAt
			FROM documents
			WHERE user_id = $1
			ORDER BY created_at DESC`,
			[userId],
		);

		const documents = result.rows.map((d) => ({
			id: String(d.id),
			name: d.name,
			type: d.type || 'other',
			url: d.url || '',
			size: parseInt(d.size, 10) || 0,
			uploadedAt: d.uploadedat ? new Date(d.uploadedat).toISOString() : new Date().toISOString(),
			status: d.status || 'pending',
			fraudScore: d.fraudscore ? parseFloat(d.fraudscore) : undefined,
			ocrText: d.ocrtext || undefined,
			ocrConfidence: d.ocrconfidence ? parseFloat(d.ocrconfidence) : undefined,
			documentScore: d.documentscore ? parseInt(d.documentscore, 10) : undefined,
			verificationDetails: d.verificationdetails || undefined,
		}));

		res.json({ documents });
	} catch (err) {
		console.error('Get candidate documents error:', err);
		res.status(500).json({ error: 'Failed to fetch documents' });
	}
});

// POST /api/candidate/documents/upload — upload a document for the authenticated candidate (Issue #109)
router.post('/documents/upload', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const { name, type, url, size } = req.body;

		if (!name || !url) {
			return res.status(400).json({ error: 'Name and URL are required' });
		}

		await pool.query(`
			CREATE TABLE IF NOT EXISTS documents (
				id SERIAL PRIMARY KEY,
				user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
				name VARCHAR(500) NOT NULL,
				type VARCHAR(50) DEFAULT 'other',
				url TEXT,
				size INTEGER DEFAULT 0,
				status VARCHAR(50) DEFAULT 'pending',
				fraud_score NUMERIC(3,2),
				oer_text TEXT,
				oer_confidence NUMERIC(4,3),
				document_score INTEGER,
				verification_details JSONB DEFAULT '{}',
				created_at TIMESTAMP DEFAULT NOW()
			)
		`);

		const result = await pool.query(
			`INSERT INTO documents (user_id, name, type, url, size, status)
			 VALUES ($1, $2, $3, $4, $5, 'pending')
			 RETURNING *`,
			[userId, name, type || 'other', url, size || 0],
		);

		const d = result.rows[0];
		res.json({
			document: {
				id: String(d.id),
				name: d.name,
				type: d.type || 'other',
				url: d.url || '',
				size: parseInt(d.size, 10) || 0,
				uploadedAt: d.created_at ? new Date(d.created_at).toISOString() : new Date().toISOString(),
				status: 'pending',
			},
		});
	} catch (err) {
		console.error('Upload document error:', err);
		res.status(500).json({ error: 'Failed to upload document' });
	}
});

// DELETE /api/candidate/documents/:id — delete a document (Issue #109)
router.delete('/documents/:id', authMiddleware, async (req, res) => {
	try {
		const userId = req.user.id;
		const result = await pool.query(
			'DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id',
			[req.params.id, userId],
		);
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Document not found' });
		}
		res.json({ success: true });
	} catch (err) {
		console.error('Delete document error:', err);
		res.status(500).json({ error: 'Failed to delete document' });
	}
});

// ============= OUTREACH ATTEMPTS =============

// List outreach attempts for an application
router.get('/outreach/:applicationId', authMiddleware, async (req, res) => {
	try {
		const applicationId = parseInt(req.params.applicationId, 10);
		if (!applicationId || applicationId <= 0) {
			return res.status(400).json({ error: 'Invalid application ID' });
		}

		// Verify ownership
		const appCheck = await pool.query(
			'SELECT id FROM job_applications WHERE id = $1 AND candidate_id = $2',
			[applicationId, req.user.id],
		);
		if (appCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const result = await pool.query(
			`
			SELECT id, application_id, method, message, status, created_at, updated_at
			FROM outreach_attempts
			WHERE application_id = $1 AND user_id = $2
			ORDER BY created_at DESC
			`,
			[applicationId, req.user.id],
		);

		res.json({ success: true, attempts: result.rows });
	} catch (err) {
		console.error('Get outreach error:', err);
		res.status(500).json({ error: 'Failed to get outreach attempts' });
	}
});

// Create new outreach attempt
router.post('/outreach', authMiddleware, async (req, res) => {
	try {
		const { application_id, method, message, status } = req.body;

		if (!application_id) {
			return res.status(400).json({ error: 'application_id is required' });
		}
		if (!method || !['email', 'linkedin', 'phone', 'other'].includes(method)) {
			return res.status(400).json({ error: 'method must be email, linkedin, phone, or other' });
		}

		// Verify ownership
		const appCheck = await pool.query(
			'SELECT id FROM job_applications WHERE id = $1 AND candidate_id = $2',
			[application_id, req.user.id],
		);
		if (appCheck.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const result = await pool.query(
			`
			INSERT INTO outreach_attempts (application_id, user_id, method, message, status)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, application_id, method, message, status, created_at, updated_at
			`,
			[application_id, req.user.id, method, message || null, status || 'pending'],
		);

		res.json({ success: true, attempt: result.rows[0] });
	} catch (err) {
		console.error('Create outreach error:', err);
		res.status(500).json({ error: 'Failed to create outreach attempt' });
	}
});

// Update outreach status
router.put('/outreach/:id', authMiddleware, async (req, res) => {
	try {
		const { status } = req.body;
		if (!status || !['pending', 'sent', 'replied', 'follow_up', 'no_response'].includes(status)) {
			return res.status(400).json({ error: 'Invalid status' });
		}

		const result = await pool.query(
			`
			UPDATE outreach_attempts
			SET status = $3, updated_at = NOW()
			WHERE id = $1 AND user_id = $2
			RETURNING id, application_id, method, message, status, created_at, updated_at
			`,
			[req.params.id, req.user.id, status],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Outreach attempt not found' });
		}

		res.json({ success: true, attempt: result.rows[0] });
	} catch (err) {
		console.error('Update outreach error:', err);
		res.status(500).json({ error: 'Failed to update outreach attempt' });
	}
});

// Delete outreach attempt
router.delete('/outreach/:id', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query(
			'DELETE FROM outreach_attempts WHERE id = $1 AND user_id = $2 RETURNING id',
			[req.params.id, req.user.id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Outreach attempt not found' });
		}

		res.json({ success: true });
	} catch (err) {
		console.error('Delete outreach error:', err);
		res.status(500).json({ error: 'Failed to delete outreach attempt' });
	}
});

module.exports = router;


