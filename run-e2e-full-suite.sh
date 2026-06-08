#!/usr/bin/env bash
# Rekrut AI — Full E2E Suite Runner (shard-based)
#
# Problem: Running all ~35 spec files in a single Playwright process causes
# browser memory accumulation and SIGKILL, even with workers=1 and fullyParallel=false.
# The single browser process is reused across all files and its memory grows.
#
# Solution: Use Playwright's built-in --shard option to split the suite into
# 4 chunks. Each chunk runs in a fresh Playwright process, so the browser
# is fully terminated between chunks. This gives the same memory safety as
# per-file sequential runners, but with ~4x fewer process startups.
#
# Usage:
#   ./run-e2e-full-suite.sh
#   ./run-e2e-full-suite.sh --headed
#   ./run-e2e-full-suite.sh --debug
#   ./run-e2e-full-suite.sh --trace

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}" && pwd)"
cd "${PROJECT_ROOT}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SHARDS=4
PROJECT="chromium"
EXTRA_ARGS=""
HEADED=""

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --headed)    HEADED="--headed" ;;
    --debug)     EXTRA_ARGS+=" --debug" ;;
    --ui)        EXTRA_ARGS+=" --ui" ;;
    --trace)     EXTRA_ARGS+=" --trace on" ;;
    --timeout)   EXTRA_ARGS+=" --timeout 120000" ;;
    --verbose)   EXTRA_ARGS+=" --verbose" ;;
  esac
done

echo "========================================"
echo "  Rekrut AI E2E Full Suite (Shard Runner)"
echo "========================================"
echo "Shards:       ${SHARDS}"
echo "Project:      ${PROJECT}"
echo "Headed:       ${HEADED:-no}"
echo "Extra args:   ${EXTRA_ARGS:-none}"
echo ""

# Ensure auth state is fresh before all shards
echo "→ Running auth setup..."
if ! npx playwright test --project=setup ${HEADED} ${EXTRA_ARGS} 2>&1; then
  echo -e "${RED}Auth setup failed — aborting.${NC}"
  exit 1
fi
echo -e "${GREEN}Auth setup complete.${NC}"
echo ""

# Run each shard sequentially
TOTAL_PASSED=0
TOTAL_FAILED=0
SECONDS=0

for i in $(seq 1 ${SHARDS}); do
  echo "────────────────────────────────────────"
  echo "  Shard ${i}/${SHARDS}"
  echo "────────────────────────────────────────"

  if npx playwright test \
      --shard=${i}/${SHARDS} \
      --project=${PROJECT} \
      --no-deps \
      ${HEADED} \
      ${EXTRA_ARGS} \
      2>&1; then
    echo -e "${GREEN}✅ Shard ${i}/${SHARDS} passed${NC}"
    ((TOTAL_PASSED+=1))
  else
    echo -e "${RED}❌ Shard ${i}/${SHARDS} failed${NC}"
    ((TOTAL_FAILED+=1))
  fi
  echo ""

  # Aggressive cleanup between shards to prevent any cross-shard memory leaks
  # from orphaned browser processes that survived the previous shard
  pkill -f "chrome-headless-shell" 2>/dev/null || true
  pkill -f "Chromium" 2>/dev/null || true
done

DURATION=$SECONDS

echo "========================================"
echo "  Full Suite Summary"
echo "========================================"
echo -e "Shards passed: ${GREEN}${TOTAL_PASSED}${NC}"
echo -e "Shards failed: ${RED}${TOTAL_FAILED}${NC}"
echo "Time:          $((DURATION / 60))m $((DURATION % 60))s"
echo "========================================"

if [ ${TOTAL_FAILED} -gt 0 ]; then
  exit 1
fi
exit 0
