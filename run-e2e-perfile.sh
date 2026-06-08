#!/bin/bash
# run-e2e-perfile.sh - Run a single E2E test file, clearing auth and rate limits first
set -e
FILE=$1
PROJECT_DIR=/root/.openclaw/workspace/Rekrut_AI_v2

cd "$PROJECT_DIR"

# Clear rate limits
node -e "require('dotenv').config(); const pool = require('./lib/db'); pool.query('DELETE FROM rate_limit_buckets').then(() => console.log('Rate limits cleared')).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); })"

# Remove auth state files so setup tests run and don't cascade-skip dependent tests
rm -f e2e/.auth/candidate.json e2e/.auth/recruiter.json

# Run the test file with 1 worker, list reporter, no retries for speed
npx playwright test "$FILE" --workers=1 --reporter=list --retries=0
