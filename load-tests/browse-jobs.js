/**
 * k6 Load Test: Browse Jobs
 *
 * Simulates 100 concurrent users browsing the public job listings.
 * Target: GET /api/jobs (public, no auth required)
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

// ponytail: realistic search terms from actual app usage patterns
const SEARCH_TERMS = ['engineer', 'designer', 'manager', 'remote', 'senior', 'frontend', 'backend'];
const LOCATIONS = ['Remote', 'New York', 'San Francisco', 'London', 'Berlin', ''];
const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship'];

// Custom metrics
const browseLatency = new Trend('browse_jobs_latency');
const browseErrors = new Counter('browse_jobs_errors');

// ── k6 Options ─────────────────────────────────────────────────────────────

export const options = {
  // Thresholds: p95 < 500ms, error rate < 1%
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    browse_jobs_latency: ['p(95)<500'],
  },

  // Ramp-up → steady → ramp-down stages
  stages: [
    { duration: '30s', target: 20 },   // gentle ramp-up
    { duration: '1m', target: 100 },   // ramp to 100 concurrent users
    { duration: '2m', target: 100 },   // steady state
    { duration: '1m', target: 50 },    // begin ramp-down
    { duration: '30s', target: 0 },    // full ramp-down
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildJobsUrl() {
  const params = new URLSearchParams();

  // 70% of requests include a search term
  if (Math.random() < 0.7) {
    params.append('search', pickRandom(SEARCH_TERMS));
  }

  // 40% of requests include a location filter
  if (Math.random() < 0.4) {
    params.append('location', pickRandom(LOCATIONS));
  }

  // 30% of requests include a job type filter
  if (Math.random() < 0.3) {
    params.append('job_type', pickRandom(JOB_TYPES));
  }

  // Vary pagination
  const page = Math.floor(Math.random() * 5) + 1;
  const limit = [10, 20, 50][Math.floor(Math.random() * 3)];
  params.append('page', String(page));
  params.append('limit', String(limit));

  const qs = params.toString();
  return `${BASE_URL}/api/jobs${qs ? '?' + qs : ''}`;
}

// ── Test Scenario ──────────────────────────────────────────────────────────

export default function () {
  const url = buildJobsUrl();

  const res = http.get(url, {
    tags: { name: 'browse_jobs' },
    headers: {
      Accept: 'application/json',
    },
  });

  browseLatency.add(res.timings.duration);

  const passed = check(res, {
    'browse: status is 200': (r) => r.status === 200,
    'browse: response has jobs array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.jobs);
      } catch {
        return false;
      }
    },
    'browse: response time < 500ms': (r) => r.timings.duration < 500,
  });

  if (!passed) {
    browseErrors.add(1);
  }

  // Think time: realistic pause between page loads (1-4s)
  sleep(Math.random() * 3 + 1);
}
