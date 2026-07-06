const fs = require('fs');
const path = require('path');

// Mock database client that tracks all queries and simulates a fresh database
const existingTables = new Set(['users', 'jobs', 'interviews', 'interview_questions', 'agent_data']);
const existingColumns = {
  users: new Set(['id', 'email', 'password_hash', 'name', 'role', 'company_name', 'github_username', 'avatar_url', 'is_paid', 'stripe_subscription_id', 'created_at', 'updated_at']),
  jobs: new Set(['id', 'user_id', 'title', 'company', 'description', 'requirements', 'location', 'salary_range', 'job_type', 'status', 'created_at', 'updated_at']),
  interviews: new Set(['id', 'user_id', 'job_id', 'interview_type', 'status', 'questions', 'responses', 'ai_feedback', 'overall_score', 'duration_seconds', 'video_urls', 'created_at', 'completed_at']),
  interview_questions: new Set(['id', 'category', 'difficulty', 'question_text', 'ideal_answer_points', 'created_at']),
  agent_data: new Set(['id', 'type', 'data', 'created_at']),
};
const existingConstraints = new Set();

const client = {
  query: async (sql, params) => {
    console.log(`[MOCK QUERY] ${sql.substring(0, 100)}...`);
    
    // Simulate CREATE TABLE IF NOT EXISTS
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
    if (createMatch) {
      const table = createMatch[1].toLowerCase();
      existingTables.add(table);
      if (!existingColumns[table]) existingColumns[table] = new Set();
      return { rows: [] };
    }
    
    // Simulate CREATE INDEX IF NOT EXISTS
    const indexMatch = sql.match(/CREATE INDEX IF NOT EXISTS\s+\w+\s+ON\s+(\w+)/i);
    if (indexMatch) {
      const table = indexMatch[1].toLowerCase();
      if (!existingTables.has(table)) {
        throw new Error(`ERROR: relation "${table}" does not exist`);
      }
      return { rows: [] };
    }
    
    // Simulate ALTER TABLE
    const alterMatch = sql.match(/ALTER TABLE\s+(\w+)/i);
    if (alterMatch) {
      const table = alterMatch[1].toLowerCase();
      if (!existingTables.has(table)) {
        throw new Error(`ERROR: relation "${table}" does not exist`);
      }
      return { rows: [] };
    }
    
    // Simulate SELECT from information_schema
    if (sql.includes('information_schema.tables')) {
      const tableName = params[0].toLowerCase();
      return { rows: existingTables.has(tableName) ? [{1: 1}] : [] };
    }
    if (sql.includes('information_schema.columns')) {
      const tableName = params[0].toLowerCase();
      const colName = params[1].toLowerCase();
      const cols = existingColumns[tableName] || new Set();
      return { rows: cols.has(colName) ? [{1: 1}] : [] };
    }
    if (sql.includes('information_schema.table_constraints')) {
      const tableName = params[0].toLowerCase();
      const constraintName = params[1];
      return { rows: existingConstraints.has(`${tableName}.${constraintName}`) ? [{1: 1}] : [] };
    }
    
    // Simulate SELECT from _migrations
    if (sql.includes('_migrations')) {
      return { rows: [] };
    }
    
    // Simulate INSERT
    if (sql.includes('INSERT INTO')) {
      return { rows: [] };
    }
    
    return { rows: [] };
  }
};

async function testMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();
  
  for (const file of files) {
    try {
      const migration = require(path.join(migrationsDir, file));
      const migrationName = migration.name || file.replace('.js', '');
      console.log(`\n=== Testing: ${file} (${migrationName}) ===`);
      
      if (migration.up) {
        await migration.up(client);
        console.log(`✅ ${file} passed`);
      } else {
        console.log(`⚠️ ${file} has no up() function`);
      }
    } catch (err) {
      console.log(`❌ ${file} FAILED: ${err.message}`);
      console.log(`Error stack: ${err.stack}`);
      break;
    }
  }
}

testMigrations().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
