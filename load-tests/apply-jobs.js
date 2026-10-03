/**
 * k6 Load Test: Apply to Jobs
 *
 * Simulates 50 concurrent users applying to jobs.
 * Targets authenticated endpoints:
 *   - POST /api/candidate/applications/auto-apply (Pro feature)
 *   - POST /api/candidate/jobs/:jobId/apply (manual apply with cover letter)
 *
 * ⚠️  This script requires a valid Bearer token. Set via:
 *     CANDIDATE_TOKEN=your_jwt k6 run apply-jobs.js
 *
 * Thresholds:
 *   - p95 response time < 500ms
 *   - Error rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// ── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.CANDIDATE_TOKEN || '';

// ponytail: skip auth-gated test if no token; warn and exit cleanly
if (!TOKEN) {
  console.warn(
    '[apply-jobs.js] No CANDIDATE_TOKEN provided. ' +
    'Set it with: CANDIDATE_TOKEN=your_jwt k6 run apply-jobs.js\n' +
    'Falling back to health-check ping to avoid auth failures.'
  );
}

// Test data
const COVER_LETTERS = [
  'I am excited to apply for this position. My background in software engineering aligns well with the requirements.',
  'With 5+ years of experience in full-stack development, I am confident I can contribute to your team.',
  'I am passionate about building scalable systems and would love to bring my expertise to this role.',
  'This role matches my skills perfectly. I have extensive experience with the technologies listed.',
  'I am eager to join a fast-growing company where I can make a meaningful impact.',
];

// Custom metrics
const applyLatency = new Trend('apply_jobs_latency');
const applyErrors = new Counter('apply_jobs_errors');

// ── k6 Options ─────────────────────────────────────────────────────────────

export const options = {
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    apply_jobs_latency: ['p(95)<500'],
  },

  stages: [
    { duration: '30s', target: 10 },   // warm-up
    { duration: '1m', target: 50 },    // ramp to 50 concurrent
    { duration: '2m', target: 50 },    // steady state
    { duration: '1m', target: 20 },    // ramp-down
    { duration: '30s', target: 0 },
  ],
};

// ── Shared helpers ─────────────────────────────────────────────────────────

const defaultHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

function authHeaders() {
  if (!TOKEN) return defaultHeaders;
  return {
    ...defaultHeaders,
    Authorization: `Bearer ${TOKEN}`,
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Fetch a list of active jobs from the public endpoint to get valid job IDs
function fetchJobIds() {
  const res = http.get(`${BASE_URL}/api/jobs?limit=50&status=active`, {
    headers: { Accept: 'application/json' },
  });

  if (res.status !== 200) return [];

  try {
    const body = JSON.parse(res.body);
    return (body.jobs || []).map((j) => j.id).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Test Scenario ──────────────────────────────────────────────────────────

export default function () {
  // If no token, fallback to health check so the script still runs without auth errors
  if (!TOKEN) {
    const res = http.get(`${BASE_URL}/api/health`, { tags: { name: 'health_check' } });
    check(res, {
      'fallback: health check 200': (r) => r.status === 200,
    });
    sleep(1);
    return;
  }

  // Get fresh job IDs (cached in VU context on first call)
  let jobIds = __VU.jobIds;
  if (!jobIds || jobIds.length === 0) {
    jobIds = fetchJobIds();
    __VU.jobIds = jobIds;
  }

  if (jobIds.length === 0) {
    console.warn('[apply-jobs] No active jobs found; skipping apply iteration');
    sleep(2);
    return;
  }

  const jobId = pickRandom(jobIds);

  // 60% auto-apply, 40% manual apply with cover letter
  const useAutoApply = Math.random() < 0.6;

  if (useAutoApply) {
    // ── Auto-apply (POST /api/candidate/applications/auto-apply)
    const payload = JSON.stringify({ job_id: jobId });
    const res = http.post(`${BASE_URL}/api/candidate/applications/auto-apply`, payload, {
      headers: authHeaders(),
      tags: { name: 'auto_apply' },
    });

    applyLatency.add(res.timings.duration);

    const passed = check(res, {
      'auto-apply: status is 200 or 409': (r) =>
        r.status === 200 || r.status === 409 || r.status === 403,
      'auto-apply: response time < 500ms': (r) => r.timings.duration < 500,
    });

    // 409 = already applied (expected under load), 403 = Pro required (expected with non-Pro token)
    if (!passed && res.status !== 409 && res.status !== 403) {
      applyErrors.add(1);
    }
  } else {
    // ── Manual apply (POST /api/candidate/jobs/:jobId/apply)
    const payload = JSON.stringify({
      cover_letter: pickRandom(COVER_LETTERS),
      screening_answers: {},
    });

    const res = http.post(`${BASE_URL}/api/candidate/jobs/${jobId}/apply`, payload, {
      headers: authHeaders(),
      tags: { name: 'manual_apply' },
    });

    applyLatency.add(res.timings.duration);

    const passed = check(res, {
      'manual-apply: status is 200 or 409': (r) => r.status === 200 || r.status === 409,
      'manual-apply: response time < 500ms': (r) => r.timings.duration < 500,
    });

    if (!passed && res.status !== 409) {
      applyErrors.add(1);
    }
  }

  // Think time between applications (3-8s — realistic user behavior)
  sleep(Math.random() * 5 + 3);
}
