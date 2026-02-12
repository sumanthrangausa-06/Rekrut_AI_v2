// Candidate Profile API Routes
const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { authMiddleware } = require('../lib/auth');
const pool = require('../lib/db');
const {
  parseResume,
  generateSkillAssessment,
  evaluateSkillAssessment,
  generateJobMatchScore,
  generateInterviewCoaching
} = require('../lib/polsia-ai');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Helper function to extract text from various file formats
async function extractTextFromFile(buffer, mimetype) {
  try {
    // Handle PDF files
    if (mimetype === 'application/pdf' || buffer.toString('utf-8', 0, 4) === '%PDF') {
      const pdfData = await pdfParse(buffer);
      return pdfData.text;
    }

    // Handle DOCX files (application/vnd.openxmlformats-officedocument.wordprocessingml.document)
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        buffer.toString('utf-8', 0, 2) === 'PK') {
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
    const profile = await pool.query(`
      SELECT cp.*, u.name, u.email, u.avatar_url
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
    `, [req.user.id]);

    const experience = await pool.query(
      'SELECT * FROM work_experience WHERE user_id = $1 ORDER BY order_index, start_date DESC',
      [req.user.id]
    );

    const education = await pool.query(
      'SELECT * FROM education WHERE user_id = $1 ORDER BY order_index, start_date DESC',
      [req.user.id]
    );

    const skills = await pool.query(
      'SELECT * FROM candidate_skills WHERE user_id = $1 ORDER BY level DESC, skill_name',
      [req.user.id]
    );

    const projects = await pool.query(
      'SELECT * FROM portfolio_projects WHERE user_id = $1 ORDER BY order_index, start_date DESC',
      [req.user.id]
    );

    res.json({
      success: true,
      profile: profile.rows[0] || {},
      experience: experience.rows,
      education: education.rows,
      skills: skills.rows,
      projects: projects.rows
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
      headline, bio, location, phone,
      linkedin_url, github_url, portfolio_url,
      availability, salary_min, salary_max,
      preferred_job_types, preferred_locations,
      remote_preference, years_experience
    } = req.body;

    // Check if profile exists
    const existing = await pool.query(
      'SELECT id FROM candidate_profiles WHERE user_id = $1',
      [req.user.id]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(`
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
      `, [req.user.id, headline, bio, location, phone,
          linkedin_url, github_url, portfolio_url,
          availability, salary_min, salary_max,
          JSON.stringify(preferred_job_types), JSON.stringify(preferred_locations),
          remote_preference, years_experience]);
    } else {
      result = await pool.query(`
        INSERT INTO candidate_profiles (
          user_id, headline, bio, location, phone,
          linkedin_url, github_url, portfolio_url,
          availability, salary_min, salary_max,
          preferred_job_types, preferred_locations,
          remote_preference, years_experience
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [req.user.id, headline, bio, location, phone,
          linkedin_url, github_url, portfolio_url,
          availability, salary_min, salary_max,
          JSON.stringify(preferred_job_types || ['full-time']),
          JSON.stringify(preferred_locations || []),
          remote_preference || 'hybrid', years_experience || 0]);
    }

    // Also update user name if provided
    if (req.body.name) {
      await pool.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2',
        [req.body.name, req.user.id]);
    }

    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
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

    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const uploadResult = await uploadRes.json();
    if (!uploadResult.success) {
      throw new Error(uploadResult.error?.message || 'Upload failed');
    }

    // Update profile with photo URL
    await pool.query(`
      INSERT INTO candidate_profiles (user_id, photo_url)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET photo_url = $2, updated_at = NOW()
    `, [req.user.id, uploadResult.file.url]);

    // Also update user avatar
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2',
      [uploadResult.file.url, req.user.id]);

    res.json({ success: true, photo_url: uploadResult.file.url });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// ============= RESUME PARSING =============

// Upload and parse resume
router.post('/resume/upload', authMiddleware, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload to R2
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const uploadResult = await uploadRes.json();
    if (!uploadResult.success) {
      throw new Error(uploadResult.error?.message || 'Upload failed');
    }

    // Save parsed resume record
    const resumeRecord = await pool.query(`
      INSERT INTO parsed_resumes (user_id, original_filename, file_url, parsing_status)
      VALUES ($1, $2, $3, 'processing')
      RETURNING id
    `, [req.user.id, req.file.originalname, uploadResult.file.url]);

    // Update profile with resume URL
    await pool.query(`
      INSERT INTO candidate_profiles (user_id, resume_url)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET resume_url = $2, updated_at = NOW()
    `, [req.user.id, uploadResult.file.url]);

    // Extract text from the resume (supports PDF, DOCX, and plain text)
    let parsedData = null;
    try {
      // Extract text from the file buffer
      const resumeText = await extractTextFromFile(req.file.buffer, req.file.mimetype);

      if (resumeText && resumeText.trim().length > 50) {
        // Get user's subscription for tracking
        const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [req.user.id]);
        const subscriptionId = user.rows[0]?.stripe_subscription_id;

        // Parse with AI, with a 30-second timeout
        const parsePromise = parseResume(resumeText.substring(0, 15000), { subscriptionId });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI parsing timeout')), 30000)
        );

        parsedData = await Promise.race([parsePromise, timeoutPromise]);

        // Update the record with parsed data
        await pool.query(`
          UPDATE parsed_resumes
          SET parsed_data = $1, parsing_status = 'completed', parsed_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(parsedData), resumeRecord.rows[0].id]);

        console.log(`Successfully parsed ${req.file.mimetype} resume for user ${req.user.id}`);

        // ====== AUTO-APPLY parsed data to profile ======
        try {
          const applySummary = { profile: false, experience: 0, education: 0, skills: 0 };

          // 1. Apply contact/profile info
          if (parsedData.contact) {
            await pool.query(`
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
            `, [
              req.user.id,
              parsedData.headline || null,
              parsedData.bio || null,
              parsedData.contact.location || null,
              parsedData.contact.phone || null,
              parsedData.contact.linkedin || null,
              parsedData.contact.github || null,
              parsedData.contact.portfolio || null,
              parsedData.years_experience || null
            ]);
            applySummary.profile = true;

            // Update user name/email if empty
            if (parsedData.contact.name) {
              await pool.query(
                `UPDATE users SET name = $1 WHERE id = $2 AND (name IS NULL OR name = '')`,
                [parsedData.contact.name, req.user.id]
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
                [req.user.id, exp.company, exp.title]
              );
              if (existing.rows.length > 0) continue;

              await pool.query(`
                INSERT INTO work_experience (user_id, company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used, order_index)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              `, [
                req.user.id,
                exp.company,
                exp.title,
                exp.location || null,
                exp.start_date ? new Date(exp.start_date.length === 4 ? exp.start_date + '-01-01' : exp.start_date + '-01') : null,
                exp.end_date && exp.end_date !== 'Present' ? new Date(exp.end_date.length === 4 ? exp.end_date + '-01-01' : exp.end_date + '-01') : null,
                exp.is_current || exp.end_date === 'Present',
                exp.description || null,
                JSON.stringify(exp.achievements || []),
                JSON.stringify(exp.skills_used || []),
                i
              ]);
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
                [req.user.id, edu.institution, edu.degree || '']
              );
              if (existing.rows.length > 0) continue;

              await pool.query(`
                INSERT INTO education (user_id, institution, degree, field_of_study, start_date, end_date, gpa, achievements, order_index)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `, [
                req.user.id,
                edu.institution,
                edu.degree || null,
                edu.field || null,
                edu.start_date ? new Date(edu.start_date + '-01-01') : null,
                edu.end_date && edu.end_date !== 'Present' ? new Date(edu.end_date + '-01-01') : null,
                edu.gpa || null,
                JSON.stringify(edu.achievements || []),
                i
              ]);
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
                  const lvlMap = { 'beginner': 1, 'basic': 2, 'intermediate': 3, 'advanced': 4, 'expert': 5 };
                  skillLevel = lvlMap[skillLevel.toLowerCase()] || parseInt(skillLevel, 10) || 3;
                }
                skillLevel = Math.max(1, Math.min(5, parseInt(skillLevel, 10) || 3));
                await pool.query(`
                  INSERT INTO candidate_skills (user_id, skill_name, category, level)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT (user_id, skill_name) DO UPDATE SET
                    category = COALESCE(NULLIF($3, ''), candidate_skills.category),
                    level = GREATEST(candidate_skills.level, $4)
                `, [req.user.id, skill.name, skill.category || 'technical', skillLevel]);
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
        await pool.query(`
          UPDATE parsed_resumes
          SET parsing_status = 'uploaded', parsed_at = NOW()
          WHERE id = $1
        `, [resumeRecord.rows[0].id]);
      }
    } catch (parseErr) {
      console.error('Resume parsing failed (non-fatal):', parseErr.message);
      await pool.query(`
        UPDATE parsed_resumes
        SET parsing_status = 'failed', parsed_at = NOW()
        WHERE id = $1
      `, [resumeRecord.rows[0].id]);
    }

    res.json({
      success: true,
      resume_url: uploadResult.file.url,
      parsed_data: parsedData,
      resume_id: resumeRecord.rows[0].id
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
      await pool.query(`
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
      `, [
        req.user.id,
        parsed_data.headline,
        parsed_data.bio,
        parsed_data.contact.location,
        parsed_data.contact.linkedin,
        parsed_data.contact.github,
        parsed_data.contact.portfolio,
        parsed_data.years_experience
      ]);

      // Update user name if found
      if (parsed_data.contact.name) {
        await pool.query('UPDATE users SET name = $1 WHERE id = $2 AND (name IS NULL OR name = \'\')',
          [parsed_data.contact.name, req.user.id]);
      }
    }

    // Apply work experience
    if (sections.includes('experience') && parsed_data.experience) {
      for (let i = 0; i < parsed_data.experience.length; i++) {
        const exp = parsed_data.experience[i];
        await pool.query(`
          INSERT INTO work_experience (user_id, company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          req.user.id,
          exp.company,
          exp.title,
          exp.location,
          exp.start_date ? new Date(exp.start_date + '-01') : null,
          exp.end_date && exp.end_date !== 'Present' ? new Date(exp.end_date + '-01') : null,
          exp.is_current || exp.end_date === 'Present',
          exp.description,
          JSON.stringify(exp.achievements || []),
          JSON.stringify(exp.skills_used || []),
          i
        ]);
      }
    }

    // Apply education
    if (sections.includes('education') && parsed_data.education) {
      for (let i = 0; i < parsed_data.education.length; i++) {
        const edu = parsed_data.education[i];
        await pool.query(`
          INSERT INTO education (user_id, institution, degree, field_of_study, start_date, end_date, gpa, achievements, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          req.user.id,
          edu.institution,
          edu.degree,
          edu.field,
          edu.start_date ? new Date(edu.start_date + '-01-01') : null,
          edu.end_date && edu.end_date !== 'Present' ? new Date(edu.end_date + '-01-01') : null,
          edu.gpa,
          JSON.stringify(edu.achievements || []),
          i
        ]);
      }
    }

    // Apply skills
    if (sections.includes('skills') && parsed_data.skills) {
      for (const skill of parsed_data.skills) {
        // Coerce string level names to integers
        let skillLevel = skill.level || 3;
        if (typeof skillLevel === 'string') {
          const lvlMap = { 'beginner': 1, 'basic': 2, 'intermediate': 3, 'advanced': 4, 'expert': 5 };
          skillLevel = lvlMap[skillLevel.toLowerCase()] || parseInt(skillLevel, 10) || 3;
        }
        skillLevel = Math.max(1, Math.min(5, parseInt(skillLevel, 10) || 3));
        await pool.query(`
          INSERT INTO candidate_skills (user_id, skill_name, category, level)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, skill_name) DO UPDATE SET
            category = COALESCE($3, candidate_skills.category),
            level = GREATEST(candidate_skills.level, $4)
        `, [req.user.id, skill.name, skill.category || 'technical', skillLevel]);
      }
    }

    res.json({ success: true, message: 'Resume data applied to profile' });
  } catch (err) {
    console.error('Apply resume error:', err);
    res.status(500).json({ error: 'Failed to apply resume data' });
  }
});

// ============= WORK EXPERIENCE =============

router.post('/experience', authMiddleware, async (req, res) => {
  try {
    const { company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used } = req.body;

    if (!company_name || !String(company_name).trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const result = await pool.query(`
      INSERT INTO work_experience (user_id, company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [req.user.id, String(company_name).trim(), String(title).trim(), location, start_date, end_date, is_current, description,
        JSON.stringify(achievements || []), JSON.stringify(skills_used || [])]);

    res.json({ success: true, experience: result.rows[0] });
  } catch (err) {
    console.error('Add experience error:', err);
    res.status(500).json({ error: 'Failed to add experience' });
  }
});

router.put('/experience/:id', authMiddleware, async (req, res) => {
  try {
    const { company_name, title, location, start_date, end_date, is_current, description, achievements, skills_used } = req.body;

    const result = await pool.query(`
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
    `, [req.params.id, req.user.id, company_name, title, location, start_date, end_date, is_current, description,
        achievements ? JSON.stringify(achievements) : null, skills_used ? JSON.stringify(skills_used) : null]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Experience not found' });
    }

    res.json({ success: true, experience: result.rows[0] });
  } catch (err) {
    console.error('Update experience error:', err);
    res.status(500).json({ error: 'Failed to update experience' });
  }
});

router.delete('/experience/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM work_experience WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete experience error:', err);
    res.status(500).json({ error: 'Failed to delete experience' });
  }
});

// ============= EDUCATION =============

router.post('/education', authMiddleware, async (req, res) => {
  try {
    const { institution, degree, field_of_study, start_date, end_date, is_current, gpa, achievements } = req.body;

    const result = await pool.query(`
      INSERT INTO education (user_id, institution, degree, field_of_study, start_date, end_date, is_current, gpa, achievements)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [req.user.id, institution, degree, field_of_study, start_date, end_date, is_current, gpa,
        JSON.stringify(achievements || [])]);

    res.json({ success: true, education: result.rows[0] });
  } catch (err) {
    console.error('Add education error:', err);
    res.status(500).json({ error: 'Failed to add education' });
  }
});

router.put('/education/:id', authMiddleware, async (req, res) => {
  try {
    const { institution, degree, field_of_study, start_date, end_date, is_current, gpa, achievements } = req.body;

    const result = await pool.query(`
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
    `, [req.params.id, req.user.id, institution, degree, field_of_study, start_date, end_date, is_current, gpa,
        achievements ? JSON.stringify(achievements) : null]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Education not found' });
    }

    res.json({ success: true, education: result.rows[0] });
  } catch (err) {
    console.error('Update education error:', err);
    res.status(500).json({ error: 'Failed to update education' });
  }
});

router.delete('/education/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM education WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]);
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
      [req.user.id]
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
      const levelMap = { 'beginner': 1, 'basic': 2, 'intermediate': 3, 'advanced': 4, 'expert': 5 };
      level = levelMap[level.toLowerCase()] || parseInt(level, 10) || 3;
    }
    level = Math.max(1, Math.min(5, parseInt(level, 10) || 3));

    const result = await pool.query(`
      INSERT INTO candidate_skills (user_id, skill_name, category, level, years_experience)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, skill_name) DO UPDATE SET
        category = COALESCE($3, candidate_skills.category),
        level = COALESCE($4, candidate_skills.level),
        years_experience = COALESCE($5, candidate_skills.years_experience)
      RETURNING *
    `, [req.user.id, String(skill_name).trim(), category || 'technical', level, years_experience || 0]);

    res.json({ success: true, skill: result.rows[0] });
  } catch (err) {
    console.error('Add skill error:', err);
    res.status(500).json({ error: 'Failed to add skill' });
  }
});

router.put('/skills/:id', authMiddleware, async (req, res) => {
  try {
    const { level, category, years_experience } = req.body;

    const result = await pool.query(`
      UPDATE candidate_skills SET
        level = COALESCE($3, level),
        category = COALESCE($4, category),
        years_experience = COALESCE($5, years_experience)
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [req.params.id, req.user.id, level, category, years_experience]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ success: true, skill: result.rows[0] });
  } catch (err) {
    console.error('Update skill error:', err);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

router.delete('/skills/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM candidate_skills WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete skill error:', err);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

// ============= SKILL ASSESSMENTS =============

router.get('/assessments', authMiddleware, async (req, res) => {
  try {
    const assessments = await pool.query(`
      SELECT sa.*, cs.skill_name
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      WHERE sa.user_id = $1
      ORDER BY sa.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, assessments: assessments.rows });
  } catch (err) {
    console.error('Get assessments error:', err);
    res.status(500).json({ error: 'Failed to get assessments' });
  }
});

// Start a new skill assessment
router.post('/assessments/start', authMiddleware, async (req, res) => {
  try {
    const { skill_id, skill_name, skill_level, category } = req.body;

    // Get user's subscription
    const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [req.user.id]);
    const subscriptionId = user.rows[0]?.stripe_subscription_id;

    // Generate assessment questions
    const questions = await generateSkillAssessment(
      skill_name,
      skill_level || 3,
      category || 'technical',
      { subscriptionId }
    );

    // Create assessment record
    const result = await pool.query(`
      INSERT INTO skill_assessments (user_id, skill_id, assessment_type, title, questions, started_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `, [req.user.id, skill_id, 'skill_verification', `${skill_name} Assessment`, JSON.stringify(questions)]);

    res.json({
      success: true,
      assessment: result.rows[0],
      questions: questions.map(q => ({
        question: q.question,
        options: q.options,
        difficulty: q.difficulty
      }))
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
      [assessmentId, req.user.id]
    );

    if (assessment.rows.length === 0) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    const questions = assessment.rows[0].questions;

    // Get skill name for evaluation
    let skillName = assessment.rows[0].title.replace(' Assessment', '');
    if (assessment.rows[0].skill_id) {
      const skill = await pool.query('SELECT skill_name FROM candidate_skills WHERE id = $1', [assessment.rows[0].skill_id]);
      if (skill.rows.length > 0) skillName = skill.rows[0].skill_name;
    }

    // Get user's subscription
    const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [req.user.id]);
    const subscriptionId = user.rows[0]?.stripe_subscription_id;

    // Evaluate with AI
    const evaluation = await evaluateSkillAssessment(questions, responses, skillName, { subscriptionId });

    // Update assessment record
    await pool.query(`
      UPDATE skill_assessments SET
        responses = $2,
        score = $3,
        passed = $4,
        ai_feedback = $5,
        completed_at = NOW()
      WHERE id = $1
    `, [assessmentId, JSON.stringify(responses), evaluation.score, evaluation.passed, JSON.stringify(evaluation)]);

    // If passed, verify the skill
    if (evaluation.passed && assessment.rows[0].skill_id) {
      await pool.query(`
        UPDATE candidate_skills SET
          is_verified = true,
          verified_at = NOW(),
          verified_score = $2,
          level = GREATEST(level, $3)
        WHERE id = $1
      `, [assessment.rows[0].skill_id, evaluation.score, evaluation.recommended_level || 3]);
    }

    res.json({
      success: true,
      evaluation,
      passed: evaluation.passed
    });
  } catch (err) {
    console.error('Submit assessment error:', err);
    res.status(500).json({ error: 'Failed to submit assessment' });
  }
});

// ============= PORTFOLIO PROJECTS =============

router.post('/projects', authMiddleware, async (req, res) => {
  try {
    const { title, description, project_url, github_url, image_url, technologies, role, start_date, end_date, highlights } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }

    const result = await pool.query(`
      INSERT INTO portfolio_projects (user_id, title, description, project_url, github_url, image_url, technologies, role, start_date, end_date, highlights)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [req.user.id, String(title).trim(), description, project_url, github_url, image_url,
        JSON.stringify(technologies || []), role, start_date, end_date, JSON.stringify(highlights || [])]);

    res.json({ success: true, project: result.rows[0] });
  } catch (err) {
    console.error('Add project error:', err);
    res.status(500).json({ error: 'Failed to add project' });
  }
});

router.put('/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, project_url, github_url, image_url, technologies, role, start_date, end_date, highlights } = req.body;

    const result = await pool.query(`
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
    `, [req.params.id, req.user.id, title, description, project_url, github_url, image_url,
        technologies ? JSON.stringify(technologies) : null, role, start_date, end_date,
        highlights ? JSON.stringify(highlights) : null]);

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
    await pool.query('DELETE FROM portfolio_projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ============= JOB MATCHING =============

// Get jobs with match scores
router.get('/jobs/recommended', authMiddleware, async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // Get candidate profile
    const profile = await pool.query(`
      SELECT cp.*, u.name, os.total_score as omniscore
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE u.id = $1
    `, [req.user.id]);

    const skills = await pool.query(
      'SELECT skill_name FROM candidate_skills WHERE user_id = $1',
      [req.user.id]
    );

    const experience = await pool.query(
      'SELECT title FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3',
      [req.user.id]
    );

    // Get active jobs
    const jobs = await pool.query(`
      SELECT j.*, u.company_name as posted_by_company
      FROM jobs j
      LEFT JOIN users u ON j.user_id = u.id
      WHERE j.status = 'active'
      ORDER BY j.created_at DESC
      LIMIT $1
    `, [limit]);

    const candidateProfile = {
      ...profile.rows[0],
      skills: skills.rows,
      titles: experience.rows.map(e => e.title)
    };

    // Calculate match scores for each job
    const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [req.user.id]);
    const subscriptionId = user.rows[0]?.stripe_subscription_id;

    const jobsWithScores = await Promise.all(jobs.rows.map(async (job) => {
      try {
        const match = await generateJobMatchScore(candidateProfile, job, { subscriptionId });
        return { ...job, match };
      } catch (e) {
        return { ...job, match: { match_score: 50, match_level: 'fair' } };
      }
    }));

    // Sort by match score
    jobsWithScores.sort((a, b) => (b.match?.match_score || 0) - (a.match?.match_score || 0));

    res.json({ success: true, jobs: jobsWithScores });
  } catch (err) {
    console.error('Get recommended jobs error:', err);
    res.status(500).json({ error: 'Failed to get recommended jobs' });
  }
});

// Save a job
router.post('/jobs/:jobId/save', authMiddleware, async (req, res) => {
  try {
    const { notes } = req.body;

    await pool.query(`
      INSERT INTO saved_jobs (user_id, job_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, job_id) DO UPDATE SET notes = $3
    `, [req.user.id, req.params.jobId, notes]);

    res.json({ success: true });
  } catch (err) {
    console.error('Save job error:', err);
    res.status(500).json({ error: 'Failed to save job' });
  }
});

router.delete('/jobs/:jobId/save', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [req.user.id, req.params.jobId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Unsave job error:', err);
    res.status(500).json({ error: 'Failed to unsave job' });
  }
});

// Get saved jobs
router.get('/jobs/saved', authMiddleware, async (req, res) => {
  try {
    const jobs = await pool.query(`
      SELECT j.*, sj.saved_at, sj.notes, u.company_name as posted_by_company
      FROM saved_jobs sj
      JOIN jobs j ON sj.job_id = j.id
      LEFT JOIN users u ON j.user_id = u.id
      WHERE sj.user_id = $1
      ORDER BY sj.saved_at DESC
    `, [req.user.id]);

    res.json({ success: true, jobs: jobs.rows });
  } catch (err) {
    console.error('Get saved jobs error:', err);
    res.status(500).json({ error: 'Failed to get saved jobs' });
  }
});

// Apply to a job
router.post('/jobs/:jobId/apply', authMiddleware, async (req, res) => {
  try {
    const { cover_letter, screening_answers } = req.body;

    // Get match score
    const profile = await pool.query(`
      SELECT cp.*, u.name, os.total_score as omniscore
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE u.id = $1
    `, [req.user.id]);

    const skills = await pool.query(
      'SELECT skill_name FROM candidate_skills WHERE user_id = $1',
      [req.user.id]
    );

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.jobId]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const candidateProfile = {
      ...profile.rows[0],
      skills: skills.rows
    };

    const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [req.user.id]);
    const subscriptionId = user.rows[0]?.stripe_subscription_id;

    let matchScore = 50;
    try {
      const match = await generateJobMatchScore(candidateProfile, job.rows[0], { subscriptionId });
      matchScore = match.match_score;
    } catch (e) {}

    // Get omniscore for application
    const omniscore = profile.rows[0]?.omniscore || null;

    const result = await pool.query(`
      INSERT INTO job_applications (candidate_id, job_id, company_id, cover_letter, match_score, omniscore_at_apply, screening_answers)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (job_id, candidate_id) DO UPDATE SET
        cover_letter = $4,
        screening_answers = $7,
        updated_at = NOW()
      RETURNING *
    `, [req.user.id, req.params.jobId, job.rows[0].company_id, cover_letter, matchScore, omniscore, JSON.stringify(screening_answers || {})]);

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
              updates.salary_min = parseInt(nums[0].replace(/,/g, ''));
              if (nums.length > 1) updates.salary_max = parseInt(nums[1].replace(/,/g, ''));
            }
          } else if (q.category === 'availability') {
            updates.availability = String(answer);
          } else if (q.category === 'experience') {
            // Map experience bracket to years
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

        // Update profile with extracted data (only non-null fields)
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
              values
            );
          }
        }
      } catch (enrichErr) {
        console.error('Profile enrichment from screening (non-blocking):', enrichErr.message);
      }
    }

    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    console.error('Apply to job error:', err);
    res.status(500).json({ error: 'Failed to apply to job' });
  }
});

// Get my applications
router.get('/applications', authMiddleware, async (req, res) => {
  try {
    const applications = await pool.query(`
      SELECT ja.*, j.title, j.company, j.location, j.salary_range, j.job_type,
             j.screening_questions, u.company_name as posted_by_company
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN users u ON j.user_id = u.id
      WHERE ja.candidate_id = $1
      ORDER BY ja.applied_at DESC
    `, [req.user.id]);

    res.json({ success: true, applications: applications.rows });
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

// Withdraw an application
router.put('/applications/:id/withdraw', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    // Verify application belongs to candidate and is withdrawable
    const existing = await pool.query(
      `SELECT id, status FROM job_applications WHERE id = $1 AND candidate_id = $2`,
      [req.params.id, req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const app = existing.rows[0];
    if (['withdrawn', 'hired', 'rejected'].includes(app.status)) {
      return res.status(400).json({ error: `Cannot withdraw an application with status: ${app.status}` });
    }

    const result = await pool.query(
      `UPDATE job_applications SET status = 'withdrawn', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    console.error('Withdraw application error:', err);
    res.status(500).json({ error: 'Failed to withdraw application' });
  }
});

// ============= INTERVIEW COACHING =============

router.post('/coaching', authMiddleware, async (req, res) => {
  try {
    const { question, response, feedback } = req.body;

    const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [req.user.id]);
    const subscriptionId = user.rows[0]?.stripe_subscription_id;

    const coaching = await generateInterviewCoaching(question, response, feedback, { subscriptionId });

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
      [req.user.id]
    );

    // Get profile completeness
    const profile = await pool.query(
      'SELECT * FROM candidate_profiles WHERE user_id = $1',
      [req.user.id]
    );

    const skillCount = await pool.query(
      'SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE is_verified) as verified FROM candidate_skills WHERE user_id = $1',
      [req.user.id]
    );

    const experienceCount = await pool.query(
      'SELECT COUNT(*) as count FROM work_experience WHERE user_id = $1',
      [req.user.id]
    );

    const educationCount = await pool.query(
      'SELECT COUNT(*) as count FROM education WHERE user_id = $1',
      [req.user.id]
    );

    const interviewCount = await pool.query(
      'SELECT COUNT(*) as total, AVG(overall_score) as avg_score FROM interviews WHERE user_id = $1 AND status = \'completed\'',
      [req.user.id]
    );

    const applicationCount = await pool.query(
      'SELECT COUNT(*) as count FROM job_applications WHERE candidate_id = $1',
      [req.user.id]
    );

    const savedJobCount = await pool.query(
      'SELECT COUNT(*) as count FROM saved_jobs WHERE user_id = $1',
      [req.user.id]
    );

    const assessmentCount = await pool.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE passed) as passed FROM skill_assessments WHERE user_id = $1 AND completed_at IS NOT NULL',
      [req.user.id]
    );

    // Calculate profile completeness
    const p = profile.rows[0] || {};
    const completenessFields = [
      p.headline, p.bio, p.location, p.linkedin_url || p.github_url,
      parseInt(skillCount.rows[0]?.count) > 0,
      parseInt(experienceCount.rows[0]?.count) > 0
    ];
    const completeness = Math.round((completenessFields.filter(Boolean).length / completenessFields.length) * 100);

    res.json({
      success: true,
      stats: {
        omniscore: omniscore.rows[0] || { total_score: 300, score_tier: 'new' },
        profile_completeness: completeness,
        skills: {
          total: parseInt(skillCount.rows[0]?.count) || 0,
          verified: parseInt(skillCount.rows[0]?.verified) || 0
        },
        experience_count: parseInt(experienceCount.rows[0]?.count) || 0,
        education_count: parseInt(educationCount.rows[0]?.count) || 0,
        interviews: {
          total: parseInt(interviewCount.rows[0]?.total) || 0,
          avg_score: Math.round(interviewCount.rows[0]?.avg_score) || 0
        },
        applications: parseInt(applicationCount.rows[0]?.count) || 0,
        saved_jobs: parseInt(savedJobCount.rows[0]?.count) || 0,
        assessments: {
          total: parseInt(assessmentCount.rows[0]?.total) || 0,
          passed: parseInt(assessmentCount.rows[0]?.passed) || 0
        }
      }
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
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found or already responded' });
    }

    res.json({ success: true, interview: result.rows[0] });
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
       SET status = 'declined', outcome = $3, updated_at = NOW()
       WHERE id = $1 AND candidate_id = $2 AND status IN ('scheduled', 'confirmed')
       RETURNING *`,
      [req.params.id, req.user.id, reason || 'Candidate declined']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found or cannot be declined' });
    }

    res.json({ success: true, interview: result.rows[0] });
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
      [req.params.id, req.user.id, reason, preferred_time]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found or cannot be rescheduled' });
    }

    res.json({ success: true, interview: result.rows[0] });
  } catch (err) {
    console.error('Reschedule interview error:', err);
    res.status(500).json({ error: 'Failed to request reschedule' });
  }
});

// ============= AI FEATURES =============

// AI Resume Optimizer — tailored suggestions for a specific job
router.post('/ai/resume-optimizer', authMiddleware, async (req, res) => {
  try {
    const { job_id } = req.body;
    const { chat } = require('../lib/polsia-ai');

    // Get candidate profile
    const profile = await pool.query(`
      SELECT cp.*, u.name, u.email FROM candidate_profiles cp
      RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1
    `, [req.user.id]);
    const skills = await pool.query('SELECT skill_name, category, years_experience FROM candidate_skills WHERE user_id = $1', [req.user.id]);
    const experience = await pool.query('SELECT company_name, title, description, achievements, skills_used FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC', [req.user.id]);
    const education = await pool.query('SELECT institution, degree, field_of_study FROM education WHERE user_id = $1', [req.user.id]);

    let jobContext = '';
    if (job_id) {
      const job = await pool.query('SELECT title, description, requirements FROM jobs WHERE id = $1', [job_id]);
      if (job.rows[0]) {
        jobContext = `\nTARGET JOB:\nTitle: ${job.rows[0].title}\nDescription: ${job.rows[0].description?.substring(0, 500)}\nRequirements: ${job.rows[0].requirements?.substring(0, 500)}`;
      }
    }

    const prompt = `Analyze this candidate's profile and provide specific resume optimization suggestions${job_id ? ' tailored to the target job' : ''}.

CANDIDATE:
Name: ${profile.rows[0]?.name}
Skills: ${skills.rows.map(s => `${s.skill_name} (${s.years_experience || '?'}y)`).join(', ') || 'None listed'}
Experience: ${experience.rows.map(e => `${e.title} at ${e.company_name}`).join('; ') || 'None listed'}
Education: ${education.rows.map(e => `${e.degree} from ${e.institution}`).join('; ') || 'None listed'}
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
      system: 'You are an expert resume coach and ATS optimization specialist. Be specific and actionable. Always return valid JSON.'
    });

    let parsed;
    try { parsed = JSON.parse(result); } catch { const m = result.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' }; }
    res.json({ success: true, optimization: parsed });
  } catch (err) {
    console.error('AI resume optimizer error:', err);
    res.status(500).json({ error: 'Failed to optimize resume' });
  }
});

// AI Cover Letter Generator — creates a tailored cover letter
router.post('/ai/cover-letter', authMiddleware, async (req, res) => {
  try {
    const { job_id } = req.body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    const { chat } = require('../lib/polsia-ai');

    const profile = await pool.query(`
      SELECT cp.*, u.name, u.email FROM candidate_profiles cp
      RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1
    `, [req.user.id]);
    const skills = await pool.query('SELECT skill_name, years_experience FROM candidate_skills WHERE user_id = $1', [req.user.id]);
    const experience = await pool.query('SELECT company_name, title, description FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3', [req.user.id]);
    const job = await pool.query('SELECT title, company, description, requirements FROM jobs WHERE id = $1', [job_id]);

    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });

    const prompt = `Write a compelling, professional cover letter for this candidate applying to this job.

CANDIDATE:
Name: ${profile.rows[0]?.name}
Skills: ${skills.rows.map(s => `${s.skill_name} (${s.years_experience || '?'}y)`).join(', ')}
Recent Experience: ${experience.rows.map(e => `${e.title} at ${e.company_name}: ${e.description?.substring(0, 200)}`).join('\n')}

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
      system: 'You are an expert career coach writing compelling cover letters. Be authentic, specific, and persuasive. Never use generic filler. Always return valid JSON.'
    });

    let parsed;
    try { parsed = JSON.parse(result); } catch { const m = result.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' }; }
    res.json({ success: true, ...parsed });
  } catch (err) {
    console.error('AI cover letter error:', err);
    res.status(500).json({ error: 'Failed to generate cover letter' });
  }
});

// AI Screening Answer Suggestions — based on stored profile and past answers
router.post('/ai/screening-suggestions', authMiddleware, async (req, res) => {
  try {
    const { job_id, questions } = req.body;
    if (!questions || !Array.isArray(questions)) return res.status(400).json({ error: 'questions array required' });
    const { chat } = require('../lib/polsia-ai');

    // Get profile data
    const profile = await pool.query(`SELECT cp.*, u.name FROM candidate_profiles cp RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1`, [req.user.id]);
    const skills = await pool.query('SELECT skill_name, years_experience FROM candidate_skills WHERE user_id = $1', [req.user.id]);
    const experience = await pool.query('SELECT title, company_name FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 3', [req.user.id]);

    // Get past screening answers
    const pastAnswers = await pool.query(`
      SELECT ja.screening_answers FROM job_applications ja WHERE ja.candidate_id = $1 AND ja.screening_answers IS NOT NULL
      ORDER BY ja.applied_at DESC LIMIT 5
    `, [req.user.id]);

    const pastData = pastAnswers.rows.map(r => r.screening_answers).filter(Boolean);

    const prompt = `Suggest answers to these screening questions based on the candidate's profile and past answers.

CANDIDATE:
Name: ${profile.rows[0]?.name}
Skills: ${skills.rows.map(s => `${s.skill_name} (${s.years_experience || '?'}y)`).join(', ')}
Experience: ${experience.rows.map(e => `${e.title} at ${e.company_name}`).join('; ')}
Location: ${profile.rows[0]?.location || 'Not specified'}
Salary preference: ${profile.rows[0]?.salary_min ? `$${profile.rows[0].salary_min}-$${profile.rows[0].salary_max}` : 'Not specified'}
Availability: ${profile.rows[0]?.availability || 'Not specified'}

PAST ANSWERS (for reuse):
${JSON.stringify(pastData).substring(0, 1000)}

QUESTIONS TO ANSWER:
${questions.map((q, i) => `${i + 1}. [${q.type}] ${q.question} ${q.options ? '(Options: ' + q.options.join(', ') + ')' : ''}`).join('\n')}

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
      system: 'You are a career assistant helping candidates fill out screening questions. Use their actual profile data. Be truthful - never fabricate information. Always return valid JSON.'
    });

    let parsed;
    try { parsed = JSON.parse(result); } catch { const m = result.match(/\[[\s\S]*\]/); parsed = m ? JSON.parse(m[0]) : []; }
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
    const profile = await pool.query(`
      SELECT cp.*, u.name, u.email FROM candidate_profiles cp
      RIGHT JOIN users u ON u.id = cp.user_id WHERE u.id = $1
    `, [req.user.id]);

    // Get resume URL
    const resumeData = await pool.query('SELECT resume_url FROM candidate_profiles WHERE user_id = $1', [req.user.id]);

    // Get screening questions for this job
    const job = await pool.query('SELECT screening_questions FROM jobs WHERE id = $1', [jobId]);
    const screeningQuestions = job.rows[0]?.screening_questions || [];

    // Find past answers for similar questions
    const pastApps = await pool.query(`
      SELECT screening_answers, cover_letter FROM job_applications
      WHERE candidate_id = $1 AND screening_answers IS NOT NULL
      ORDER BY applied_at DESC LIMIT 10
    `, [req.user.id]);

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
          answerMap[q.id] = { value: `$${p.salary_min.toLocaleString()} - $${(p.salary_max || p.salary_min).toLocaleString()}`, source: 'profile' };
        } else if (q.category === 'availability' && p.availability) {
          answerMap[q.id] = { value: p.availability, source: 'profile' };
        } else if (q.category === 'relocation') {
          answerMap[q.id] = { value: p.remote_preference === 'remote' ? 'No' : 'Yes', source: 'profile' };
        } else if (q.category === 'experience') {
          const yrs = p.years_experience || 0;
          const bracket = yrs < 1 ? '0-1 years' : yrs < 3 ? '1-3 years' : yrs < 5 ? '3-5 years' : yrs < 10 ? '5-10 years' : '10+ years';
          answerMap[q.id] = { value: bracket, source: 'profile' };
        }
      }
    }

    // Find the most recent cover letter
    const lastCoverLetter = pastApps.rows.find(a => a.cover_letter)?.cover_letter || '';

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
        }
      }
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
    const offers = await pool.query(`
      SELECT o.*,
             j.title as job_title, j.company as company_name, j.location as job_location,
             u.name as recruiter_name
      FROM offers o
      JOIN jobs j ON o.job_id = j.id
      LEFT JOIN users u ON o.recruiter_id = u.id
      WHERE o.candidate_id = $1 AND o.status != 'draft'
      ORDER BY o.sent_at DESC NULLS LAST, o.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, offers: offers.rows });
  } catch (err) {
    console.error('Get offers error:', err);
    res.status(500).json({ error: 'Failed to get offers' });
  }
});

// View single offer (marks as viewed)
router.get('/offers/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*,
             j.title as job_title, j.company as company_name, j.description as job_description,
             j.location as job_location, j.job_type,
             u.name as recruiter_name, u.email as recruiter_email
      FROM offers o
      JOIN jobs j ON o.job_id = j.id
      LEFT JOIN users u ON o.recruiter_id = u.id
      WHERE o.id = $1 AND o.candidate_id = $2 AND o.status != 'draft'
    `, [req.params.id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Mark as viewed if not already
    if (!result.rows[0].viewed_at) {
      await pool.query(
        'UPDATE offers SET viewed_at = NOW() WHERE id = $1',
        [req.params.id]
      );
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
      [req.params.id, req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    if (existing.rows[0].status !== 'sent') {
      return res.status(400).json({ error: `Cannot accept offer with status: ${existing.rows[0].status}` });
    }

    const result = await pool.query(
      `UPDATE offers SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    // Update application status to 'hired'
    await pool.query(
      `UPDATE job_applications SET status = 'hired', updated_at = NOW()
       WHERE job_id = $1 AND candidate_id = $2`,
      [existing.rows[0].job_id, req.user.id]
    );

    // Update job analytics
    try {
      await pool.query(
        'UPDATE job_analytics SET offers_accepted = COALESCE(offers_accepted, 0) + 1 WHERE job_id = $1',
        [existing.rows[0].job_id]
      );
    } catch (e) { /* non-critical */ }

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
      [req.params.id, req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    if (existing.rows[0].status !== 'sent') {
      return res.status(400).json({ error: `Cannot decline offer with status: ${existing.rows[0].status}` });
    }

    const result = await pool.query(
      `UPDATE offers SET status = 'declined', declined_at = NOW(), decline_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, reason || null]
    );

    res.json({ success: true, offer: result.rows[0] });
  } catch (err) {
    console.error('Decline offer error:', err);
    res.status(500).json({ error: 'Failed to decline offer' });
  }
});

module.exports = router;
