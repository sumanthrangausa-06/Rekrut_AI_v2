const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_IC0wumYoWbe4@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const userId = 14;
    const whereClause = "WHERE j.status = 'active'";
    const params = [userId, userId, 20, 0];
    
    const jobsQuery = `
      SELECT 
        j.id, j.title, j.description, j.company, j.company as poster_company, j.location, j.job_type,
        j.salary_min, j.salary_max, j.salary_range, j.currency_code, j.country_code,
        j.status, j.created_at, j.updated_at, j.screening_questions,
        j.requirements, j.user_id,
        EXISTS(SELECT 1 FROM job_applications a WHERE a.job_id = j.id AND a.candidate_id = $1 LIMIT 1) as has_applied,
        EXISTS(SELECT 1 FROM saved_jobs sj WHERE sj.job_id = j.id AND sj.user_id = $2 LIMIT 1) as has_saved
      FROM jobs j
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT $3 OFFSET $4
    `;
    
    console.log('Query:', jobsQuery);
    console.log('Params:', params);
    
    const result = await pool.query(jobsQuery, params);
    console.log('Result:', result.rows.length, 'rows');
    console.log('First row:', result.rows[0]);
  } catch (e) {
    console.error('Error:', e.message);
    console.error('Detail:', e.detail);
  } finally {
    await pool.end();
  }
}
main();
