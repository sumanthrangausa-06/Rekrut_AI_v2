// MemGPT-Style AI Memory Service
// Stores and retrieves AI-extracted insights per user across all sessions
const pool = require('../lib/db');

// Memory types for categorization
const MEMORY_TYPES = {
  OBSERVATION: 'observation',      // "User prefers remote roles"
  PREFERENCE: 'preference',        // "Likes fintech companies"
  BEHAVIOR: 'behavior',            // "Always applies within 24hrs"
  SKILL_INSIGHT: 'skill_insight',  // "Strong in React, learning Go"
  CAREER_GOAL: 'career_goal',      // "Wants to transition to management"
  INTERACTION: 'interaction',      // "Applied to 3 jobs at TechCorp"
  RECRUITER_PATTERN: 'recruiter_pattern' // "Typically hires 5+ years exp"
};

/**
 * Add or update a memory entry for a user
 */
async function addMemory(userId, { type, key, value, source, confidence }) {
  try {
    const result = await pool.query(`
      INSERT INTO user_memory (user_id, memory_type, memory_key, memory_value, source, confidence)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, memory_key) WHERE memory_key IS NOT NULL
      DO UPDATE SET
        memory_value = EXCLUDED.memory_value,
        confidence = GREATEST(user_memory.confidence, EXCLUDED.confidence),
        access_count = user_memory.access_count + 1,
        updated_at = NOW()
      RETURNING *
    `, [userId, type || 'observation', key, value, source || 'system', confidence || 0.80]);

    return result.rows[0];
  } catch (err) {
    // If unique constraint doesn't exist, just insert
    if (err.code === '42P10' || err.code === '23505') {
      const result = await pool.query(`
        INSERT INTO user_memory (user_id, memory_type, memory_key, memory_value, source, confidence)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [userId, type || 'observation', key, value, source || 'system', confidence || 0.80]);
      return result.rows[0];
    }
    console.error('Add memory error:', err.message);
    return null;
  }
}

/**
 * Get all memories for a user, optionally filtered by type
 */
async function getMemories(userId, { type, limit = 50 } = {}) {
  try {
    let query = `
      SELECT * FROM user_memory
      WHERE user_id = $1
    `;
    const params = [userId];

    if (type) {
      query += ` AND memory_type = $2`;
      params.push(type);
    }

    query += ` ORDER BY confidence DESC, updated_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    // Update access counts
    if (result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      await pool.query(`
        UPDATE user_memory SET access_count = access_count + 1, last_accessed = NOW()
        WHERE id = ANY($1)
      `, [ids]);
    }

    return result.rows;
  } catch (err) {
    console.error('Get memories error:', err.message);
    return [];
  }
}

/**
 * Build memory context string for AI prompts
 */
async function buildMemoryContext(userId) {
  const memories = await getMemories(userId, { limit: 20 });
  if (memories.length === 0) return '';

  const grouped = {};
  for (const m of memories) {
    const type = m.memory_type || 'observation';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(m.memory_value);
  }

  let context = 'User context from previous interactions:\n';
  for (const [type, values] of Object.entries(grouped)) {
    context += `\n${type.replace(/_/g, ' ').toUpperCase()}:\n`;
    values.forEach(v => { context += `- ${v}\n`; });
  }

  return context;
}

/**
 * Extract and store memories from an application submission
 */
async function extractFromApplication(userId, applicationData) {
  const memories = [];

  if (applicationData.job_type) {
    memories.push({
      type: MEMORY_TYPES.PREFERENCE,
      key: `preferred_job_type_${applicationData.job_type}`,
      value: `Applied to ${applicationData.job_type} position`,
      source: 'application'
    });
  }

  if (applicationData.salary_expectation) {
    memories.push({
      type: MEMORY_TYPES.PREFERENCE,
      key: 'salary_expectation',
      value: `Salary expectation: $${applicationData.salary_expectation}`,
      source: 'application'
    });
  }

  if (applicationData.location) {
    memories.push({
      type: MEMORY_TYPES.PREFERENCE,
      key: `location_preference_${applicationData.location.toLowerCase().replace(/\s+/g, '_')}`,
      value: `Interested in jobs in ${applicationData.location}`,
      source: 'application'
    });
  }

  if (applicationData.remote_preference) {
    memories.push({
      type: MEMORY_TYPES.PREFERENCE,
      key: 'remote_preference',
      value: `Prefers ${applicationData.remote_preference} work arrangement`,
      source: 'application'
    });
  }

  if (applicationData.company) {
    memories.push({
      type: MEMORY_TYPES.INTERACTION,
      key: `applied_to_${applicationData.company.toLowerCase().replace(/\s+/g, '_')}`,
      value: `Applied to ${applicationData.job_title || 'position'} at ${applicationData.company}`,
      source: 'application'
    });
  }

  for (const mem of memories) {
    await addMemory(userId, mem);
  }

  return memories.length;
}

/**
 * Extract and store memories from recruiter actions
 */
async function extractFromRecruiterAction(recruiterId, action) {
  const memories = [];

  if (action.type === 'job_posted') {
    memories.push({
      type: MEMORY_TYPES.RECRUITER_PATTERN,
      key: `posting_pattern_${action.job_type || 'general'}`,
      value: `Posted ${action.job_type || 'general'} role: ${action.job_title}`,
      source: 'job_posting'
    });
  }

  if (action.type === 'candidate_advanced') {
    memories.push({
      type: MEMORY_TYPES.RECRUITER_PATTERN,
      key: `advancement_pattern`,
      value: `Advanced candidate with ${action.experience_years || 'N/A'} years experience for ${action.job_title}`,
      source: 'pipeline_action'
    });
  }

  if (action.type === 'candidate_feedback') {
    memories.push({
      type: MEMORY_TYPES.RECRUITER_PATTERN,
      key: `feedback_pattern_${action.feedback_type}`,
      value: `Gave ${action.feedback_type} feedback on candidate for ${action.job_title}`,
      source: 'feedback'
    });
  }

  for (const mem of memories) {
    await addMemory(recruiterId, mem);
  }

  return memories.length;
}

module.exports = {
  MEMORY_TYPES,
  addMemory,
  getMemories,
  buildMemoryContext,
  extractFromApplication,
  extractFromRecruiterAction
};
