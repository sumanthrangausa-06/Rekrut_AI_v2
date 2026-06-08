const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'startup-error.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) {}
}

function logError(msg, err) {
  const line = `[${new Date().toISOString()}] ERROR: ${msg}`;
  console.error(line);
  if (err) {
    console.error(err.stack || err.message || String(err));
    try {
      fs.appendFileSync(logFile, line + '\n' + (err.stack || err.message || String(err)) + '\n');
    } catch (e) {}
  }
}

try { fs.writeFileSync(logFile, ''); } catch (e) {}

log('=== COMPREHENSIVE DIAGNOSTIC ===');
log(`Node: ${process.version}`);
log(`CWD: ${process.cwd()}`);
log(`PORT: ${process.env.PORT}`);
log(`NODE_ENV: ${process.env.NODE_ENV}`);

// Check all env vars that the app might need
const requiredVars = [
  'DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET', 'PORT',
  'POLSIA_API_KEY', 'POLSIA_API_URL', 'OPENAI_API_KEY', 'NVIDIA_NIM_API_KEY',
  'NIM_BASE_URL', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'DEEPGRAM_API_KEY',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'
];

for (const v of requiredVars) {
  log(`${v}: ${process.env[v] ? 'SET' : 'MISSING'}`);
}

// Try loading each route file individually
const routeFiles = [
  'routes/auth.js', 'routes/candidate.js', 'routes/recruiter.js',
  'routes/jobs.js', 'routes/interviews.js', 'routes/assessments.js',
  'routes/screening.js', 'routes/onboarding.js', 'routes/payroll.js',
  'routes/communications.js', 'routes/memory.js', 'routes/omniscore.js',
  'routes/compliance.js', 'routes/documents.js', 'routes/company.js',
  'routes/trustscore.js', 'routes/admin.js', 'routes/analytics.js',
  'routes/countries.js', 'routes/quick-practice.js', 'routes/billing.js',
  'routes/notifications.js', 'routes/matching.js'
];

for (const f of routeFiles) {
  try {
    log(`Loading ${f}...`);
    require(`./${f}`);
    log(`  ✓ ${f}`);
  } catch (err) {
    logError(`  ✗ ${f} FAILED`, err);
  }
}

// Try loading server.js
log('=== LOADING server.js ===');
try {
  require('./server.js');
  log('Server loaded successfully');
} catch (err) {
  logError('Server.js FAILED', err);
}

// Keep running so Render doesn't kill us immediately
log('Diagnostic complete. Keeping alive...');
setInterval(() => {
  log('Still alive');
}, 30000);

// Start a simple HTTP server to serve the logs
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/diagnostic') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    try {
      const logContent = fs.readFileSync(logFile, 'utf8');
      res.end(logContent);
    } catch (e) {
      res.end('No logs available');
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Diagnostic server running. Check /diagnostic for logs.');
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  log(`Diagnostic server listening on port ${PORT}`);
});
