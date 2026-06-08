#!/usr/bin/env bash
# run-e2e-suite.sh
# Runs each Playwright spec file individually in sequence to avoid SIGKILL
# from browser memory limits when running the full suite at once.
#
# Usage:
#   ./e2e/run-e2e-suite.sh
#   ./e2e/run-e2e-suite.sh --headed
#   ./e2e/run-e2e-suite.sh --debug

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="${PROJECT_ROOT}/e2e"

cd "${PROJECT_ROOT}"

# Parse optional flags
EXTRA_ARGS=""
for arg in "$@"; do
  case "$arg" in
    --headed) EXTRA_ARGS="${EXTRA_ARGS} --headed" ;;
    --debug)  EXTRA_ARGS="${EXTRA_ARGS} --debug" ;;
    --ui)     EXTRA_ARGS="${EXTRA_ARGS} --ui" ;;
    --trace)  EXTRA_ARGS="${EXTRA_ARGS} --trace on" ;;
    --timeout) EXTRA_ARGS="${EXTRA_ARGS} --timeout 120000" ;;
  esac
done

echo "========================================"
echo "  Rekrut AI E2E Sequential Runner"
echo "========================================"
echo "Project root: ${PROJECT_ROOT}"
echo "Extra args:   ${EXTRA_ARGS:-none}"
echo ""

# Ensure auth state is fresh before running specs
# This avoids re-running setup for every single spec file.
echo "→ Running auth setup first..."
if ! npx playwright test --project=setup ${EXTRA_ARGS} 2>&1; then
  echo -e "${RED}Auth setup failed — aborting suite.${NC}"
  exit 1
fi
echo -e "${GREEN}Auth setup complete.${NC}"
echo ""

# Collect all spec files (sorted for deterministic order)
mapfile -t SPEC_FILES < <(find "${E2E_DIR}" -maxdepth 1 -name '*.spec.ts' | sort)

TOTAL=${#SPEC_FILES[@]}
PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

SECONDS=0

echo "→ Running ${TOTAL} spec files sequentially (one at a time)..."
echo ""

for SPEC in "${SPEC_FILES[@]}"; do
  FILENAME=$(basename "$SPEC")

  # Re-run auth setup if auth files went missing (another test may have
  # cleared them or they may have expired)
  if [ ! -f "e2e/.auth/candidate.json" ] || [ ! -f "e2e/.auth/recruiter.json" ]; then
    echo "  → Auth files missing, re-running auth setup..."
    if ! npx playwright test --project=setup ${EXTRA_ARGS} 2>&1; then
      echo -e "${YELLOW}  ⚠️ Auth setup failed — continuing with ${FILENAME}${NC}"
    fi
  fi

  echo "────────────────────────────────────────"
  echo "Running: ${FILENAME}"
  echo "────────────────────────────────────────"

  # Run only the chromium project (skip setup since we ran it already)
  # We use --no-deps to prevent Playwright from re-running setup
  if npx playwright test "$SPEC" --project=chromium --no-deps ${EXTRA_ARGS} 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}  ${FILENAME}"
    ((PASSED++)) || true
    RESULTS+=("${GREEN}PASS${NC}  ${FILENAME}")
  else
    EXIT_CODE=$?
    # Check if it was a soft skip (all tests skipped) — Playwright exits 0 for all-skipped
    # If exit code != 0, it's a real failure
    echo -e "${RED}❌ FAIL${NC}  ${FILENAME} (exit ${EXIT_CODE})"
    ((FAILED++)) || true
    RESULTS+=("${RED}FAIL${NC}  ${FILENAME}")
  fi
  echo ""
done

DURATION=$SECONDS

# Summary
echo "========================================"
echo "  E2E Suite Summary"
echo "========================================"
printf "%-40s %s\n" "Spec File" "Result"
echo "────────────────────────────────────────"
for r in "${RESULTS[@]}"; do
  printf "%-40s %b\n" "" "$r"
done
echo "────────────────────────────────────────"
printf "Total:  %d\n" $TOTAL
printf "Passed: %d\n" $PASSED
printf "Failed: %d\n" $FAILED
printf "Skipped:%d\n" $SKIPPED
printf "Time:   %dm %ds\n" $((DURATION / 60)) $((DURATION % 60))
printf "Pass rate: %.1f%%\n" $(awk "BEGIN {print ($PASSED / $TOTAL) * 100}")
echo "========================================"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
exit 0
