#!/usr/bin/env node
/**
 * Diagnostic wrapper for server startup
 * Catches and logs any startup errors to stdout and to a file
 */
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'startup-error.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function logError(msg, err) {
  const line = `[${new Date().toISOString()}] ERROR: ${msg}`;
  console.error(line);
  if (err) {
    console.error(err.stack || err.message || String(err));
    fs.appendFileSync(logFile, line + '\n' + (err.stack || err.message || String(err)) + '\n');
  } else {
    fs.appendFileSync(logFile, line + '\n');
  }
}

// Clear previous log
try { fs.writeFileSync(logFile, ''); } catch (e) {}

log('=== Starting diagnostic wrapper ===');
log(`Node version: ${process.version}`);
log(`Working directory: ${process.cwd()}`);
log(`PORT: ${process.env.PORT}`);
log(`NODE_ENV: ${process.env.NODE_ENV}`);
log(`DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
log(`SESSION_SECRET set: ${!!process.env.SESSION_SECRET}`);
log(`JWT_SECRET set: ${!!process.env.JWT_SECRET}`);

// Try to load each module individually
const modules = [
  'express',
  'express-session',
  'connect-pg-simple',
  'cookie-parser',
  'cors',
  'dotenv',
  './lib/db',
  './lib/auth',
  './lib/distributed-rate-limiter',
  './lib/metrics-collector',
  './lib/activity-logger',
  './lib/token-budget',
  './lib/ai-call-logger',
  './lib/polsia-ai',
  './lib/self-hosted-audio',
];

for (const mod of modules) {
  try {
    log(`Loading module: ${mod}`);
    require(mod);
    log(`  ✓ ${mod} loaded successfully`);
  } catch (err) {
    logError(`  ✗ ${mod} failed to load`, err);
  }
}

// Try to start the actual server
log('=== Attempting to start server.js ===');
try {
  require('./server.js');
  log('Server started successfully');
} catch (err) {
  logError('Server failed to start', err);
  
  // Start a fallback server that serves the error log
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/diagnostic') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      try {
        const logContent = fs.readFileSync(logFile, 'utf8');
        res.end(logContent);
      } catch (e) {
        res.end('No log file found');
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server startup failed. Check /diagnostic for logs.');
    }
  });
  
  const PORT = process.env.PORT || 10000;
  server.listen(PORT, () => {
    log(`Diagnostic server running on port ${PORT}`);
  });
}
