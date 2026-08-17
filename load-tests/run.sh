#!/usr/bin/env bash
#
# run.sh — Convenience script to run all k6 load tests locally
# against the dev server. Edit BASE_URL below or pass it as env var.
#
# Usage:
#   ./run.sh              # run all tests sequentially
#   ./run.sh browse       # run only browse-jobs test
#   ./run.sh apply        # run only apply-jobs test
#   ./run.sh mixed        # run only mixed-traffic test
#
# Prerequisites:
#   - k6 installed (https://k6.io/docs/get-started/installation/)
#   - Dev server running on localhost:3000 (or set BASE_URL)
#   - For apply/mixed: a valid candidate JWT in CANDIDATE_TOKEN
#
# ⚠️  Never run these against staging or production to save Neon CU hours.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Optional auth token for authenticated endpoints
CANDIDATE_TOKEN="${CANDIDATE_TOKEN:-}"

# Common k6 flags
K6_FLAGS="--env BASE_URL=${BASE_URL}"
if [[ -n "$CANDIDATE_TOKEN" ]]; then
  K6_FLAGS="${K6_FLAGS} --env CANDIDATE_TOKEN=${CANDIDATE_TOKEN}"
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

run_test() {
  local name="$1"
  local script="$2"

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  🚀  Running: ${name}"
  echo "  📍  Target:  ${BASE_URL}"
  echo "═══════════════════════════════════════════════════════════════"

  k6 run ${K6_FLAGS} "${SCRIPT_DIR}/${script}"
}

# ── Health check first ───────────────────────────────────────────────────────

echo "🔍 Checking dev server health..."
if ! curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
  echo "❌ Dev server not responding at ${BASE_URL}"
  echo "   Start the server with: npm run dev  (or your dev command)"
  exit 1
fi
echo "✅ Dev server is healthy."

# ── Run tests ────────────────────────────────────────────────────────────────

CMD="${1:-all}"

case "$CMD" in
  browse)
    run_test "Browse Jobs (100 concurrent users)" "browse-jobs.js"
    ;;
  apply)
    run_test "Apply Jobs (50 concurrent users)" "apply-jobs.js"
    ;;
  mixed)
    run_test "Mixed Traffic (70% read / 20% write / 10% heavy)" "mixed-traffic.js"
    ;;
  all|*)
    run_test "Browse Jobs (100 concurrent users)" "browse-jobs.js"
    run_test "Apply Jobs (50 concurrent users)" "apply-jobs.js"
    run_test "Mixed Traffic (70% read / 20% write / 10% heavy)" "mixed-traffic.js"
    ;;
esac

echo ""
echo "✅ All load tests completed."
