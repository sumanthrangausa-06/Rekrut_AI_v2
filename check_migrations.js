const fs = require('fs');
const path = require('path');

const migrationsDir = '/root/.openclaw/workspace/Rekrut_AI_v2/migrations';
const coreFile = '/root/.openclaw/workspace/Rekrut_AI_v2/migrate.js';

const tableColumns = new Map();

function extractCreateTable(sql) {
  // Match CREATE TABLE with or without IF NOT EXISTS
  const regex = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([^;]+)\)/gi;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase();
    const columnsStr = match[2];
    const columns = [];
    // Split by comma, but be careful with nested parens
    const parts = columnsStr.split(/,(?![^\(]*\))/g);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith('PRIMARY KEY') || trimmed.startsWith('UNIQUE') || trimmed.startsWith('FOREIGN KEY') || trimmed.startsWith('CHECK') || trimmed.startsWith('CONSTRAINT')) {
        continue;
      }
      const colMatch = trimmed.match(/^([\w_]+)\s/);
      if (colMatch) {
        columns.push(colMatch[1].toLowerCase());
      }
    }
    if (!tableColumns.has(tableName)) {
      tableColumns.set(tableName, new Set());
    }
    for (const col of columns) {
      tableColumns.get(tableName).add(col);
    }
  }
}

function extractAddColumn(sql) {
  // Match multi-column ALTER TABLE statements
  // ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255), ADD COLUMN IF NOT EXISTS linkedin_id VARCHAR(255), ...
  const regex = /ALTER TABLE\s+(\w+)\s+([\s\S]*?);/gi;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase();
    const alterBody = match[2];
    // Find all ADD COLUMN IF NOT EXISTS col_name or ADD COLUMN col_name
    const colRegex = /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([\w_]+)/gi;
    let colMatch;
    while ((colMatch = colRegex.exec(alterBody)) !== null) {
      const colName = colMatch[1].toLowerCase();
      if (!tableColumns.has(tableName)) {
        tableColumns.set(tableName, new Set());
      }
      tableColumns.get(tableName).add(colName);
    }
  }
}

// Parse core tables from migrate.js
const coreContent = fs.readFileSync(coreFile, 'utf8');
extractCreateTable(coreContent);

// Parse all migration files (only .js)
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();
for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  extractCreateTable(content);
  extractAddColumn(content);
}

// Now check 047_p2_schema_hardening.js
const p2File = fs.readFileSync(path.join(migrationsDir, '047_p2_schema_hardening.js'), 'utf8');
// Extract textConversions
const textMatch = p2File.match(/const textConversions = \{([\s\S]*?)\};/);
const p2Issues = [];
if (textMatch) {
  const evalStr = 'const textConversions = {' + textMatch[1] + '}; textConversions';
  const textConversions = eval(evalStr);
  for (const [table, columns] of Object.entries(textConversions)) {
    const tableLower = table.toLowerCase();
    if (!tableColumns.has(tableLower)) {
      p2Issues.push(`047: Table '${table}' does not exist`);
      continue;
    }
    const existingCols = tableColumns.get(tableLower);
    for (const col of columns) {
      if (!existingCols.has(col.toLowerCase())) {
        p2Issues.push(`047: Table '${table}' is missing column '${col}'`);
      }
    }
  }
}

// Check p3_schema_optimizations.js for ALTER TABLE ... ALTER COLUMN
const p3File = fs.readFileSync(path.join(migrationsDir, 'p3_schema_optimizations.js'), 'utf8');
const p3AlterRegex = /ALTER TABLE\s+(\w+)\s+ALTER COLUMN\s+([\w_]+)/gi;
const p3Issues = [];
let p3Match;
while ((p3Match = p3AlterRegex.exec(p3File)) !== null) {
  const table = p3Match[1].toLowerCase();
  const col = p3Match[2].toLowerCase();
  if (!tableColumns.has(table)) {
    p3Issues.push(`p3: Table '${table}' does not exist`);
  } else if (!tableColumns.get(table).has(col)) {
    p3Issues.push(`p3: Table '${table}' is missing column '${p3Match[2]}'`);
  }
}

// Check 047_p2_schema_hardening.js for ALTER TABLE ... ALTER COLUMN (section 1)
const p2AlterRegex = /ALTER TABLE\s+(\w+)\s+ALTER COLUMN\s+([\w_]+)/gi;
let p2Match;
while ((p2Match = p2AlterRegex.exec(p2File)) !== null) {
  const table = p2Match[1].toLowerCase();
  const col = p2Match[2].toLowerCase();
  if (!tableColumns.has(table)) {
    p2Issues.push(`047: Table '${table}' does not exist`);
  } else if (!tableColumns.get(table).has(col)) {
    p2Issues.push(`047: Table '${table}' is missing column '${p2Match[2]}'`);
  }
}

// Check 047 for CHECK constraints that reference non-existent columns
const checkRegex = /ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+\w+\s+CHECK\s*\(\s*([\w_]+)/gi;
let checkMatch;
while ((checkMatch = checkRegex.exec(p2File)) !== null) {
  const table = checkMatch[1].toLowerCase();
  const col = checkMatch[2].toLowerCase();
  if (!tableColumns.has(table)) {
    p2Issues.push(`047 CHECK: Table '${table}' does not exist`);
  } else if (!tableColumns.get(table).has(col)) {
    p2Issues.push(`047 CHECK: Table '${table}' is missing column '${checkMatch[2]}'`);
  }
}

console.log('=== P2 (047) Issues ===');
if (p2Issues.length === 0) {
  console.log('No issues found in 047');
} else {
  p2Issues.forEach(i => console.log(i));
}

console.log('\n=== P3 Issues ===');
if (p3Issues.length === 0) {
  console.log('No issues found in p3');
} else {
  p3Issues.forEach(i => console.log(i));
}

// Also print some tables for debugging
console.log('\n=== communication_sequences columns ===');
const cols = tableColumns.get('communication_sequences');
if (cols) console.log([...cols].sort());
console.log('\n=== communications columns ===');
const ucols = tableColumns.get('communications');
if (ucols) console.log([...ucols].sort());
console.log('\n=== document_verifications columns ===');
const ocols = tableColumns.get('document_verifications');
if (ocols) console.log([...ocols].sort());
console.log('\n=== users columns ===');
const dcols = tableColumns.get('users');
if (dcols) console.log([...dcols].sort());
console.log('\n=== refresh_tokens columns ===');
const rcols = tableColumns.get('refresh_tokens');
if (rcols) console.log([...rcols].sort());
console.log('\n=== trust_score_components columns ===');
const tcols = tableColumns.get('trust_score_components');
if (tcols) console.log([...tcols].sort());
console.log('\n=== score_components columns ===');
const scols = tableColumns.get('score_components');
if (scols) console.log([...scols].sort());
console.log('\n=== sequence_enrollments columns ===');
const secols = tableColumns.get('sequence_enrollments');
if (secols) console.log([...secols].sort());
