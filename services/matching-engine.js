const OpenAI = require('openai');
const pool = require('../lib/db');
const { pgvector } = require('pgvector/pg');

// Lazy-load OpenAI client to avoid initialization errors when env vars are missing
let openai = null;

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.POLSIA_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY or POLSIA_API_KEY environment variable.');
    }
    openai = new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL || 'https://polsia.com/api/proxy/openai',
      apiKey: apiKey,
    });
  }
  return openai;
}

/**
 * Generate embedding for text using OpenAI API
 */
async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000) // Limit to 8k chars
  });

  return response.data[0].embedding;
}

/**
 * Build text representation of candidate profile for embedding
 */
function buildCandidateProfileText(profile) {
  const parts = [];

  // Headline and bio
  if (profile.headline) parts.push(`Headline: ${profile.headline}`);
  if (profile.bio) parts.push(`Bio: ${profile.bio}`);

  // Skills
  if (profile.skills && profile.skills.length > 0) {
    const skillsText = profile.skills
      .map(s => `${s.skill_name} (level ${s.level})`)
      .join(', ');
    parts.push(`Skills: ${skillsText}`);
  }

  // Experience
  if (profile.experience && profile.experience.length > 0) {
    profile.experience.forEach(exp => {
      parts.push(`Experience: ${exp.title} at ${exp.company}. ${exp.description || ''}`);
      if (exp.skills_used && exp.skills_used.length > 0) {
        parts.push(`Skills used: ${exp.skills_used.join(', ')}`);
      }
    });
  }

  // Education
  if (profile.education && profile.education.length > 0) {
    profile.education.forEach(edu => {
      parts.push(`Education: ${edu.degree || ''} ${edu.field_of_study || ''} from ${edu.institution}`);
    });
  }

  // Job preferences
  if (profile.years_experience) parts.push(`Years of experience: ${profile.years_experience}`);
  if (profile.location) parts.push(`Location: ${profile.location}`);
  if (profile.preferred_job_types) parts.push(`Preferred job types: ${JSON.stringify(profile.preferred_job_types)}`);

  return parts.join('\n');
}

/**
 * Build text representation of job posting for embedding
 */
function buildJobText(job) {
  const parts = [];

  parts.push(`Job Title: ${job.title}`);
  if (job.company) parts.push(`Company: ${job.company}`);
  if (job.description) parts.push(`Description: ${job.description}`);
  if (job.requirements) parts.push(`Requirements: ${job.requirements}`);
  if (job.location) parts.push(`Location: ${job.location}`);
  if (job.salary_range) parts.push(`Salary: ${job.salary_range}`);
  if (job.job_type) parts.push(`Job Type: ${job.job_type}`);

  return parts.join('\n');
}

/**
 * Update or create candidate embedding
 */
async function updateCandidateEmbedding(userId) {
  const client = await pool.connect();
  try {
    // Fetch complete candidate profile
    const profileResult = await client.query(`
      SELECT cp.*, u.name, u.email
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
    `, [userId]);

    if (profileResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const profile = profileResult.rows[0];

    // Fetch skills
    const skillsResult = await client.query(
      'SELECT * FROM candidate_skills WHERE user_id = $1',
      [userId]
    );
    profile.skills = skillsResult.rows;

    // Fetch experience
    const experienceResult = await client.query(
      'SELECT * FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC',
      [userId]
    );
    profile.experience = experienceResult.rows;

    // Fetch education
    const educationResult = await client.query(
      'SELECT * FROM education WHERE user_id = $1',
      [userId]
    );
    profile.education = educationResult.rows;

    // Build text for embedding
    const profileText = buildCandidateProfileText(profile);

    if (!profileText || profileText.trim().length === 0) {
      console.log(`Skipping embedding for user ${userId} - empty profile`);
      return null;
    }

    // Generate embedding
    const embedding = await generateEmbedding(profileText);

    // Build summaries
    const skillsSummary = profile.skills.map(s => s.skill_name).join(', ');
    const experienceSummary = profile.experience
      .map(e => `${e.title} at ${e.company}`)
      .slice(0, 3)
      .join('; ');

    // Upsert embedding
    await client.query(`
      INSERT INTO candidate_embeddings (user_id, embedding, profile_text, skills_summary, experience_summary, last_updated)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        embedding = $2,
        profile_text = $3,
        skills_summary = $4,
        experience_summary = $5,
        last_updated = NOW()
    `, [userId, pgvector.toSql(embedding), profileText, skillsSummary, experienceSummary]);

    console.log(`Updated embedding for candidate ${userId}`);
    return embedding;
  } finally {
    client.release();
  }
}

/**
 * Update or create job embedding
 */
async function updateJobEmbedding(jobId) {
  const client = await pool.connect();
  try {
    // Fetch job details
    const jobResult = await client.query(
      'SELECT * FROM jobs WHERE id = $1',
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      throw new Error('Job not found');
    }

    const job = jobResult.rows[0];
    const jobText = buildJobText(job);

    if (!jobText || jobText.trim().length === 0) {
      console.log(`Skipping embedding for job ${jobId} - empty job text`);
      return null;
    }

    // Generate embedding
    const embedding = await generateEmbedding(jobText);

    // Upsert embedding
    await client.query(`
      INSERT INTO job_embeddings (job_id, embedding, job_text, requirements_summary, last_updated)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (job_id)
      DO UPDATE SET
        embedding = $2,
        job_text = $3,
        requirements_summary = $4,
        last_updated = NOW()
    `, [jobId, pgvector.toSql(embedding), jobText, job.requirements]);

    console.log(`Updated embedding for job ${jobId}`);
    return embedding;
  } finally {
    client.release();
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Find top matching candidates for a job
 */
async function findMatchingCandidates(jobId, options = {}) {
  const limit = options.limit || 20;
  const minScore = options.minScore || 0.5;

  const client = await pool.connect();
  try {
    // Ensure job embedding exists
    await updateJobEmbedding(jobId);

    // Get job details and TrustScore
    const jobResult = await client.query(`
      SELECT j.*, c.name as company_name, ts.total_score as trustscore
      FROM jobs j
      LEFT JOIN companies c ON j.company_id = c.id
      LEFT JOIN trust_scores ts ON c.id = ts.company_id
      WHERE j.id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
      throw new Error('Job not found');
    }

    const job = jobResult.rows[0];
    const trustscore = job.trustscore || 500;

    // Find similar candidates using vector similarity
    const matchResult = await client.query(`
      SELECT
        ce.user_id,
        ce.skills_summary,
        ce.experience_summary,
        os.total_score as omniscore,
        os.score_tier,
        cp.headline,
        cp.location,
        cp.years_experience,
        u.name,
        u.avatar_url,
        1 - (ce.embedding <=> je.embedding) as similarity_score
      FROM candidate_embeddings ce
      INNER JOIN job_embeddings je ON je.job_id = $1
      INNER JOIN users u ON ce.user_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      LEFT JOIN candidate_profiles cp ON u.id = cp.user_id
      WHERE u.role = 'candidate'
        AND 1 - (ce.embedding <=> je.embedding) >= $2
      ORDER BY similarity_score DESC
      LIMIT $3
    `, [jobId, minScore, limit]);

    // Calculate weighted scores with OmniScore and TrustScore
    const matches = matchResult.rows.map(candidate => {
      const omniscore = candidate.omniscore || 300;
      const similarityScore = candidate.similarity_score;

      // Weighted score formula:
      // Base: similarity (60%)
      // OmniScore boost: normalized 0-1 score * 30%
      // TrustScore boost: normalized 0-1 score * 10%
      const omniNormalized = Math.min(omniscore / 1000, 1); // 0-1 scale
      const trustNormalized = Math.min(trustscore / 1000, 1); // 0-1 scale

      const weightedScore = (
        (similarityScore * 0.6) +
        (omniNormalized * 0.3) +
        (trustNormalized * 0.1)
      ) * 100; // Scale to 0-100

      // Determine match level
      let matchLevel = 'poor';
      if (weightedScore >= 85) matchLevel = 'excellent';
      else if (weightedScore >= 70) matchLevel = 'good';
      else if (weightedScore >= 55) matchLevel = 'fair';

      return {
        candidate_id: candidate.user_id,
        name: candidate.name,
        avatar_url: candidate.avatar_url,
        headline: candidate.headline,
        location: candidate.location,
        years_experience: candidate.years_experience,
        omniscore: omniscore,
        score_tier: candidate.score_tier,
        skills_summary: candidate.skills_summary,
        experience_summary: candidate.experience_summary,
        similarity_score: Math.round(similarityScore * 100) / 100,
        weighted_score: Math.round(weightedScore * 100) / 100,
        match_level: matchLevel,
        explanation: {
          semantic_match: `${Math.round(similarityScore * 100)}% skill and experience alignment`,
          omniscore_boost: `OmniScore ${omniscore} (${candidate.score_tier} tier)`,
          company_trustscore: `Company TrustScore ${trustscore}`
        }
      };
    });

    // Cache results
    for (const match of matches) {
      await client.query(`
        INSERT INTO match_results (
          candidate_id, job_id, similarity_score, weighted_score,
          omniscore_at_match, trustscore_at_match, match_level,
          match_explanation, calculated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (candidate_id, job_id)
        DO UPDATE SET
          similarity_score = $3,
          weighted_score = $4,
          omniscore_at_match = $5,
          trustscore_at_match = $6,
          match_level = $7,
          match_explanation = $8,
          calculated_at = NOW()
      `, [
        match.candidate_id,
        jobId,
        match.similarity_score,
        match.weighted_score,
        match.omniscore,
        trustscore,
        match.match_level,
        JSON.stringify(match.explanation)
      ]);
    }

    return matches;
  } finally {
    client.release();
  }
}

/**
 * Find top matching jobs for a candidate
 */
async function findMatchingJobs(userId, options = {}) {
  const limit = options.limit || 20;
  const minScore = options.minScore || 0.5;

  const client = await pool.connect();
  try {
    // Ensure candidate embedding exists
    await updateCandidateEmbedding(userId);

    // Get candidate's OmniScore
    const userResult = await client.query(`
      SELECT os.total_score as omniscore
      FROM users u
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE u.id = $1
    `, [userId]);

    const omniscore = userResult.rows[0]?.omniscore || 300;

    // Find similar jobs using vector similarity
    const matchResult = await client.query(`
      SELECT
        je.job_id,
        j.title,
        j.company,
        j.location,
        j.salary_range,
        j.job_type,
        j.description,
        c.name as company_name,
        c.logo_url as company_logo,
        ts.total_score as trustscore,
        ts.score_tier as trust_tier,
        1 - (je.embedding <=> ce.embedding) as similarity_score
      FROM job_embeddings je
      INNER JOIN candidate_embeddings ce ON ce.user_id = $1
      INNER JOIN jobs j ON je.job_id = j.id
      LEFT JOIN companies c ON j.company_id = c.id
      LEFT JOIN trust_scores ts ON c.id = ts.company_id
      WHERE j.status = 'active'
        AND 1 - (je.embedding <=> ce.embedding) >= $2
      ORDER BY similarity_score DESC
      LIMIT $3
    `, [userId, minScore, limit]);

    // Calculate weighted scores
    const matches = matchResult.rows.map(job => {
      const trustscore = job.trustscore || 500;
      const similarityScore = job.similarity_score;

      // Weighted score formula:
      // Base: similarity (60%)
      // TrustScore boost: normalized 0-1 score * 30%
      // OmniScore factor: normalized 0-1 score * 10% (candidate quality affects visibility)
      const trustNormalized = Math.min(trustscore / 1000, 1);
      const omniNormalized = Math.min(omniscore / 1000, 1);

      const weightedScore = (
        (similarityScore * 0.6) +
        (trustNormalized * 0.3) +
        (omniNormalized * 0.1)
      ) * 100;

      // Determine match level
      let matchLevel = 'poor';
      if (weightedScore >= 85) matchLevel = 'excellent';
      else if (weightedScore >= 70) matchLevel = 'good';
      else if (weightedScore >= 55) matchLevel = 'fair';

      // Success prediction based on match score
      let successPrediction = 'Low';
      if (weightedScore >= 85) successPrediction = 'Very High';
      else if (weightedScore >= 75) successPrediction = 'High';
      else if (weightedScore >= 60) successPrediction = 'Moderate';

      return {
        job_id: job.job_id,
        title: job.title,
        company: job.company_name || job.company,
        company_logo: job.company_logo,
        location: job.location,
        salary_range: job.salary_range,
        job_type: job.job_type,
        description: job.description?.substring(0, 200),
        trustscore: trustscore,
        trust_tier: job.trust_tier,
        similarity_score: Math.round(similarityScore * 100) / 100,
        weighted_score: Math.round(weightedScore * 100) / 100,
        match_level: matchLevel,
        success_prediction: successPrediction,
        explanation: {
          why_matched: `${Math.round(similarityScore * 100)}% match based on your skills and experience`,
          company_quality: `Company TrustScore ${trustscore} (${job.trust_tier || 'new'} tier)`,
          your_strength: omniscore >= 700 ? 'Your strong OmniScore makes you highly competitive' :
                         omniscore >= 500 ? 'Your OmniScore is solid for this position' :
                         'Build your OmniScore to increase visibility'
        }
      };
    });

    // Cache recommendations
    for (const match of matches) {
      await client.query(`
        INSERT INTO job_recommendations (
          user_id, job_id, match_score, recommendation_reason, created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, job_id)
        DO UPDATE SET
          match_score = $3,
          recommendation_reason = $4
      `, [
        userId,
        match.job_id,
        match.weighted_score,
        `${match.match_level} match - ${match.explanation.why_matched}`
      ]);
    }

    return matches;
  } finally {
    client.release();
  }
}

/**
 * Explain why a candidate matched (or didn't match) a job
 */
async function explainMatch(candidateId, jobId) {
  const client = await pool.connect();
  try {
    // Check if match result exists
    const matchResult = await client.query(
      'SELECT * FROM match_results WHERE candidate_id = $1 AND job_id = $2',
      [candidateId, jobId]
    );

    if (matchResult.rows.length > 0) {
      return matchResult.rows[0];
    }

    // Calculate match on-demand if not cached
    await updateCandidateEmbedding(candidateId);
    await updateJobEmbedding(jobId);

    const matches = await findMatchingCandidates(jobId, { limit: 100 });
    const match = matches.find(m => m.candidate_id === candidateId);

    if (match) {
      return {
        match_level: match.match_level,
        weighted_score: match.weighted_score,
        similarity_score: match.similarity_score,
        explanation: match.explanation
      };
    }

    return {
      match_level: 'none',
      weighted_score: 0,
      explanation: {
        reason: 'Profile does not meet minimum requirements for this position'
      }
    };
  } finally {
    client.release();
  }
}

module.exports = {
  generateEmbedding,
  updateCandidateEmbedding,
  updateJobEmbedding,
  findMatchingCandidates,
  findMatchingJobs,
  explainMatch
};
