# k6 Load Testing Infrastructure

Load testing suite for Rekrut AI using [k6](https://k6.io/).

## Quick Start

```bash
# 1. Make sure k6 is installed
k6 version

# 2. Start the dev server (defaults to localhost:3000)
npm run dev

# 3. Run all tests
./run.sh

# Or run individual tests:
./run.sh browse   # 100 concurrent users browsing jobs
./run.sh apply    # 50 concurrent users applying to jobs
./run.sh mixed    # 70% read / 20% write / 10% heavy traffic mix
```

## Installing k6

### macOS
```bash
brew install k6
```

### Linux (Debian/Ubuntu)
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### Docker
```bash
docker pull grafana/k6
```

## Configuration

All scripts read the target URL from the environment:

| Variable        | Default                  | Description                           |
|-----------------|--------------------------|---------------------------------------|
| `BASE_URL`      | `http://localhost:3000`  | Base URL of the API server            |
| `CANDIDATE_TOKEN` | *(empty)*              | JWT Bearer token for auth endpoints   |

### Examples

```bash
# Run against a different local port
BASE_URL=http://localhost:8080 ./run.sh

# Run authenticated tests (get token by logging in via the app)
CANDIDATE_TOKEN=eyJhbG... ./run.sh apply

# Full example
BASE_URL=http://localhost:3000 CANDIDATE_TOKEN=eyJhbG... k6 run --env BASE_URL=http://localhost:3000 --env CANDIDATE_TOKEN=eyJhbG... apply-jobs.js
```

## Test Scripts

### `browse-jobs.js`
- **Users:** 100 concurrent (ramp-up → steady → ramp-down)
- **Target:** `GET /api/jobs` (public, no auth)
- **Behavior:** Randomized search, location, job type, and pagination params
- **Think time:** 1–4 seconds between requests

### `apply-jobs.js`
- **Users:** 50 concurrent
- **Targets:**
  - `POST /api/candidate/applications/auto-apply` (60% of requests)
  - `POST /api/candidate/jobs/:jobId/apply` (40% of requests)
- **Auth required:** Yes — set `CANDIDATE_TOKEN`
- **Fallback:** If no token, pings `/api/health` instead of failing

### `mixed-traffic.js`
- **Users:** 80 concurrent
- **Traffic mix:**
  - **70% READ** — browse jobs, view job details, health checks
  - **20% WRITE** — auto-apply, like job, dismiss job
  - **10% HEAVY** — dashboard stats, filtered search, fit scores
- **Auth:** Required for write and heavy operations; falls back to reads if absent

## Thresholds

Every script enforces:

| Metric           | Threshold           |
|------------------|---------------------|
| p95 latency      | `< 500ms`           |
| Error rate       | `< 1%`              |

k6 exits with a non-zero code if any threshold fails.

## Endpoints Tested

| Endpoint                              | Method | Auth | Scripts              |
|---------------------------------------|--------|------|----------------------|
| `/api/health`                         | GET    | No   | all                  |
| `/api/jobs`                           | GET    | No   | browse, mixed        |
| `/api/jobs/:id`                       | GET    | No   | mixed                |
| `/api/candidate/jobs/:id/like`        | POST   | Yes  | mixed                |
| `/api/candidate/jobs/:id/dismiss`     | POST   | Yes  | mixed                |
| `/api/candidate/applications/auto-apply` | POST | Yes  | apply, mixed         |
| `/api/candidate/jobs/:id/apply`       | POST   | Yes  | apply                |
| `/api/candidate/dashboard/stats`      | GET    | Yes  | mixed                |
| `/api/candidate/jobs/fit-scores`      | GET    | Yes  | mixed                |

## ⚠️ Important Notes

- **Never run against staging or production** — these tests are designed for the dev server only to avoid consuming Neon CU hours.
- The authenticated scripts gracefully degrade: if no `CANDIDATE_TOKEN` is set, they fall back to public endpoints instead of failing with 401s.
- 409 "already applied" responses are treated as expected under load and do not count as errors.
- 403 "Pro required" responses on auto-apply are also expected if the test token belongs to a free-tier user.

## CI/CD Integration

Run in CI (non-interactive mode with summary output only):

```bash
k6 run --summary-trend-stats="avg,min,med,max,p(95),p(99),count" browse-jobs.js
```

## Reference

- [k6 Documentation](https://k6.io/docs/)
- [k6 Metrics](https://k6.io/docs/using-k6/metrics/)
- [GitHub Issue #45](https://github.com/rekrutai/rekrut-ai/issues/45)
