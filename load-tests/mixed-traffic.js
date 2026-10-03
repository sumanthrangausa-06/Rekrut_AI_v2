/**
 * k6 Load Test: Mixed Traffic
 *
 * Simulates realistic production traffic mix:
 *   - 70% READ  → browse jobs, view job details, health checks
 *   - 20% WRITE → apply to jobs, auto-apply, like/dismiss jobs
 *   - 10% HEAVY → dashboard stats, search with filters (checkout-style)
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

const SEARCH_TERMS = ['engineer', 'designer', 'manager', 'remote', 'senior', 'frontend', 'backend', 'data'];
const LOCATIONS = ['Remote', 'New York', 'San Francisco', 'London', 'Berlin', 'Austin', ''];
const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship'];

// Custom metrics per traffic class
const readLatency = new Trend('read_latency');
const writeLatency = new Trend('write_latency');
const heavyLatency = new Trend('heavy_latency');
const trafficErrors = new Counter('traffic_errors');

// ── k6 Options ─────────────────────────────────────────────────────────────

export const options = {
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    read_latency: ['p(95)<500'],
    write_latency: ['p(95)<500'],
    heavy_latency: ['p(95)<500'],
  },

  stages: [
    { duration: '30s', target: 25 },
    { duration: '1m', target: 80 },
    { duration: '2m', target: 80 },
    { duration: '1m', target: 40 },
    { duration: '30s', target: 0 },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const defaultHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

function authHeaders() {
  if (!TOKEN) return defaultHeaders;
  return { ...defaultHeaders, Authorization: `Bearer ${TOKEN}` };
}

function fetchJobIds() {
  const res = http.get(`${BASE_URL}/api/jobs?limit=30&status=active`, {
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

// ── Traffic Scenarios ──────────────────────────────────────────────────────

function doRead() {
  // 70% of total traffic: lightweight GET operations
  const roll = Math.random();

  if (roll < 0.50) {
    // Browse job listings with varied filters
    const params = new URLSearchParams();
    if (Math.random() < 0.6) params.append('search', pickRandom(SEARCH_TERMS));
    if (Math.random() < 0.4) params.append('location', pickRandom(LOCATIONS));
    if (Math.random() < 0.3) params.append('job_type', pickRandom(JOB_TYPES));
    params.append('page', String(Math.floor(Math.random() * 5) + 1));
    params.append('limit', String([10, 20, 50][Math.floor(Math.random() * 3)]));

    const url = `${BASE_URL}/api/jobs?${params.toString()}`;
    const res = http.get(url, { tags: { name: 'browse_jobs' } });

    readLatency.add(res.timings.duration);
    const ok = check(res, {
      'read: browse status 200': (r) => r.status === 200,
      'read: browse < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);

  } else if (roll < 0.80) {
    // View single job detail
    const jobIds = __VU.jobIds || [];
    const jobId = jobIds.length > 0 ? pickRandom(jobIds) : Math.floor(Math.random() * 200) + 1;
    const url = `${BASE_URL}/api/jobs/${jobId}`;
    const res = http.get(url, { tags: { name: 'job_detail' } });

    readLatency.add(res.timings.duration);
    const ok = check(res, {
      'read: detail status 200/404': (r) => r.status === 200 || r.status === 404,
      'read: detail < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);

  } else {
    // Health check
    const res = http.get(`${BASE_URL}/api/health`, { tags: { name: 'health_check' } });
    readLatency.add(res.timings.duration);
    const ok = check(res, {
      'read: health 200': (r) => r.status === 200,
      'read: health < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);
  }

  sleep(Math.random() * 2 + 0.5);
}

function doWrite() {
  // 20% of total traffic: state-changing POST/PUT operations
  if (!TOKEN) {
    // No auth token: skip write operations, do a read instead
    doRead();
    return;
  }

  const jobIds = __VU.jobIds || [];
  if (jobIds.length === 0) {
    sleep(1);
    return;
  }

  const jobId = pickRandom(jobIds);
  const roll = Math.random();

  if (roll < 0.60) {
    // Auto-apply
    const payload = JSON.stringify({ job_id: jobId });
    const res = http.post(`${BASE_URL}/api/candidate/applications/auto-apply`, payload, {
      headers: authHeaders(),
      tags: { name: 'auto_apply' },
    });

    writeLatency.add(res.timings.duration);
    const ok = check(res, {
      'write: auto-apply 200/409/403': (r) =>
        r.status === 200 || r.status === 409 || r.status === 403,
      'write: auto-apply < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);

  } else if (roll < 0.85) {
    // Like a job
    const res = http.post(`${BASE_URL}/api/candidate/jobs/${jobId}/like`, null, {
      headers: authHeaders(),
      tags: { name: 'like_job' },
    });

    writeLatency.add(res.timings.duration);
    const ok = check(res, {
      'write: like 200/409': (r) => r.status === 200 || r.status === 409,
      'write: like < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);

  } else {
    // Dismiss a job
    const res = http.post(`${BASE_URL}/api/candidate/jobs/${jobId}/dismiss`, null, {
      headers: authHeaders(),
      tags: { name: 'dismiss_job' },
    });

    writeLatency.add(res.timings.duration);
    const ok = check(res, {
      'write: dismiss 200/409': (r) => r.status === 200 || r.status === 409,
      'write: dismiss < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);
  }

  sleep(Math.random() * 3 + 2);
}

function doHeavy() {
  // 10% of total traffic: heavier/complex operations
  const roll = Math.random();

  if (roll < 0.50) {
    // Candidate dashboard stats (multiple DB queries)
    if (!TOKEN) {
      // Fallback to filtered search
      const params = new URLSearchParams();
      params.append('search', pickRandom(SEARCH_TERMS));
      params.append('location', pickRandom(LOCATIONS));
      params.append('job_type', pickRandom(JOB_TYPES));
      params.append('salary_min', String(Math.floor(Math.random() * 50000) + 50000));
      params.append('limit', '20');

      const res = http.get(`${BASE_URL}/api/jobs?${params.toString()}`, {
        tags: { name: 'filtered_search' },
      });
      heavyLatency.add(res.timings.duration);
      const ok = check(res, {
        'heavy: filtered search 200': (r) => r.status === 200,
        'heavy: filtered search < 500ms': (r) => r.timings.duration < 500,
      });
      if (!ok) trafficErrors.add(1);
      return;
    }

    const res = http.get(`${BASE_URL}/api/candidate/dashboard/stats`, {
      headers: authHeaders(),
      tags: { name: 'dashboard_stats' },
    });

    heavyLatency.add(res.timings.duration);
    const ok = check(res, {
      'heavy: dashboard 200': (r) => r.status === 200,
      'heavy: dashboard < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);

  } else if (roll < 0.75) {
    // Job search with multiple filters (complex WHERE clause)
    const params = new URLSearchParams();
    params.append('search', pickRandom(SEARCH_TERMS));
    params.append('location', pickRandom(LOCATIONS));
    params.append('job_type', pickRandom(JOB_TYPES));
    params.append('salary_min', String(Math.floor(Math.random() * 50000) + 50000));
    params.append('limit', '20');

    const res = http.get(`${BASE_URL}/api/jobs?${params.toString()}`, {
      tags: { name: 'filtered_search' },
    });

    heavyLatency.add(res.timings.duration);
    const ok = check(res, {
      'heavy: filtered search 200': (r) => r.status === 200,
      'heavy: filtered search < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);

  } else {
    // Fit scores batch request (candidate endpoint, multiple IDs)
    if (!TOKEN) {
      doRead();
      return;
    }

    const jobIds = __VU.jobIds || [];
    const sampleIds = jobIds.slice(0, Math.min(10, jobIds.length)).join(',');
    if (!sampleIds) {
      doRead();
      return;
    }

    const res = http.get(`${BASE_URL}/api/candidate/jobs/fit-scores?job_ids=${sampleIds}`, {
      headers: authHeaders(),
      tags: { name: 'fit_scores' },
    });

    heavyLatency.add(res.timings.duration);
    const ok = check(res, {
      'heavy: fit-scores 200': (r) => r.status === 200,
      'heavy: fit-scores < 500ms': (r) => r.timings.duration < 500,
    });
    if (!ok) trafficErrors.add(1);
  }

  sleep(Math.random() * 2 + 1);
}

// ── Main Scenario ──────────────────────────────────────────────────────────

export default function () {
  // Cache job IDs per VU on first iteration
  if (!__VU.jobIds) {
    __VU.jobIds = fetchJobIds();
  }

  const roll = Math.random();

  if (roll < 0.70) {
    doRead();   // 70% read
  } else if (roll < 0.90) {
    doWrite();  // 20% write
  } else {
    doHeavy();  // 10% heavy/checkout-style
  }
}
