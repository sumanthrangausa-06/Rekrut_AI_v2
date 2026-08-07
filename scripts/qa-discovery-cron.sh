#!/bin/bash
# QA Discovery Cron — Finds new bugs and creates GitHub issues
# Runs every 2 hours via OpenClaw cron
# Follows gstack /qa --regression pattern

set -e

REPO_DIR="/root/.openclaw/workspace/Rekrut_AI_v2"
BASELINE_FILE="$REPO_DIR/.gstack/qa-reports/baseline.json"
REPORT_DIR="$REPO_DIR/.gstack/qa-reports"
STAGING_URL="https://rekrutai-staging.onrender.com"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RUN_ID="qa-$(date +%s)"

echo "=== QA Discovery Run: $TIMESTAMP ==="
echo "RUN_ID: $RUN_ID"
echo "TARGET: $STAGING_URL"

mkdir -p "$REPORT_DIR/screenshots"

cd "$REPO_DIR"

# ───────────────────────────────────────────────
# Phase 1: Smoke Test (Quick — 30 seconds)
# ───────────────────────────────────────────────
echo ""
echo "--- Phase 1: Smoke Test ---"

# Run Playwright smoke tests
npx playwright test e2e/smoke-test.spec.ts --reporter=json 2>/dev/null > "$REPORT_DIR/$RUN_ID-smoke.json" || true

# Check if tests passed
SMOKE_PASSED=false
if [ -f "$REPORT_DIR/$RUN_ID-smoke.json" ]; then
  SMOKE_ERRORS=$(cat "$REPORT_DIR/$RUN_ID-smoke.json" | grep -c '"status":"failed"' || echo "0")
  if [ "$SMOKE_ERRORS" -eq "0" ]; then
    SMOKE_PASSED=true
    echo "✅ Smoke tests PASSED"
  else
    echo "❌ Smoke tests FAILED ($SMOKE_ERRORS failures)"
  fi
else
  echo "⚠️ Smoke test report not generated"
fi

# ───────────────────────────────────────────────
# Phase 2: Check Baseline for NEW Issues
# ───────────────────────────────────────────────
echo ""
echo "--- Phase 2: Baseline Comparison ---"

if [ ! -f "$BASELINE_FILE" ]; then
  echo "No baseline found. Creating initial baseline."
  echo '{"created":"'$TIMESTAMP'","issues":[],"health_score":100}' > "$BASELINE_FILE"
fi

# Read baseline
BASELINE_ISSUES=$(cat "$BASELINE_FILE" | grep -o '"issues":\[.*\]' | sed 's/.*\[//;s/\].*//' || echo "")

# ───────────────────────────────────────────────
# Phase 3: Run Full E2E Suite (if smoke passed)
# ───────────────────────────────────────────────
if [ "$SMOKE_PASSED" = true ]; then
  echo ""
  echo "--- Phase 3: Full E2E Suite ---"
  
  # Run full suite and capture failures
  npx playwright test --reporter=json 2>/dev/null > "$REPORT_DIR/$RUN_ID-full.json" || true
  
  if [ -f "$REPORT_DIR/$RUN_ID-full.json" ]; then
    # Extract failed tests
    FAILED_TESTS=$(cat "$REPORT_DIR/$RUN_ID-full.json" | grep -o '"title":"[^"]*".*"status":"failed"' | sed 's/.*"title":"//;s/".*//' | sort -u || echo "")
    
    if [ -n "$FAILED_TESTS" ]; then
      echo "Failed tests found:"
      echo "$FAILED_TESTS"
      
      # Compare with baseline — only create issues for NEW failures
      NEW_ISSUES=0
      while IFS= read -r test_name; do
        [ -z "$test_name" ] && continue
        
        # Check if this test is already in baseline
        if echo "$BASELINE_ISSUES" | grep -q "$test_name"; then
          echo "  ⚠️ Known issue (in baseline): $test_name"
        else
          echo "  🆕 NEW ISSUE: $test_name"
          NEW_ISSUES=$((NEW_ISSUES + 1))
          
          # Create GitHub issue for new failure
          gh issue create \
            --repo sumanthrangausa-06/Rekrut_AI_v2 \
            --title "[AUTO-DISCOVERED] E2E Failure: $test_name" \
            --body "## Automated QA Discovery

**Test:** $test_name
**Discovered:** $TIMESTAMP
**Environment:** Staging ($STAGING_URL)
**Run ID:** $RUN_ID

### Failure Details
This test was discovered failing during automated QA regression testing.

### Next Steps
- [ ] Investigate root cause
- [ ] Fix and verify
- [ ] Update baseline after fix

---
*This issue was auto-created by the QA discovery cron.*" \
            --label "bug,e2e-failure,auto-discovered" 2>/dev/null || echo "  ⚠️ Failed to create GitHub issue (gh CLI may not be configured)"
        fi
      done <<< "$FAILED_TESTS"
      
      echo ""
      echo "New issues created: $NEW_ISSUES"
    else
      echo "✅ All tests passed — no failures found"
    fi
    
    # Update baseline with current state
    # We always update baseline to track known issues
    TOTAL_TESTS=$(cat "$REPORT_DIR/$RUN_ID-full.json" | grep -c '"status":"passed"' || echo "0")
    FAILED_COUNT=$(cat "$REPORT_DIR/$RUN_ID-full.json" | grep -c '"status":"failed"' || echo "0")
    
    # Build issues array from current failures
    ISSUES_JSON="["
    FIRST=true
    while IFS= read -r test_name; do
      [ -z "$test_name" ] && continue
      if [ "$FIRST" = true ]; then
        FIRST=false
      else
        ISSUES_JSON="$ISSUES_JSON,"
      fi
      ISSUES_JSON="$ISSUES_JSON\"$test_name\""
    done <<< "$FAILED_TESTS"
    ISSUES_JSON="$ISSUES_JSON]"
    
    # Calculate health score
    if [ "$TOTAL_TESTS" -gt 0 ]; then
      HEALTH_SCORE=$(echo "scale=0; ($TOTAL_TESTS * 100) / ($TOTAL_TESTS + $FAILED_COUNT)" | bc 2>/dev/null || echo "100")
    else
      HEALTH_SCORE=100
    fi
    
    # Write new baseline
    cat > "$BASELINE_FILE" << EOF
{
  "updated": "$TIMESTAMP",
  "run_id": "$RUN_ID",
  "total_tests": $TOTAL_TESTS,
  "failed_tests": $FAILED_COUNT,
  "health_score": $HEALTH_SCORE,
  "issues": $ISSUES_JSON
}
EOF
    
    echo ""
    echo "📊 Health Score: $HEALTH_SCORE% ($TOTAL_TESTS passed, $FAILED_COUNT failed)"
  else
    echo "⚠️ Full test report not generated"
  fi
else
  echo ""
  echo "⚠️ Smoke tests failed — skipping full suite"
  echo "This indicates a critical deployment issue."
  
  # Create P0 alert issue
  gh issue create \
    --repo sumanthrangausa-06/Rekrut_AI_v2 \
    --title "[P0] Smoke tests FAILED — Critical deployment issue" \
    --body "## 🚨 Critical Issue Detected

**Discovered:** $TIMESTAMP
**Environment:** Staging ($STAGING_URL)
**Run ID:** $RUN_ID

### Problem
Smoke tests failed, indicating the staging deployment is critically broken.

### Impact
- All E2E tests blocked
- Production deploy should be halted

### Next Steps
1. Check staging deployment status
2. Verify database connectivity
3. Check for recent breaking changes

---
*This issue was auto-created by the QA discovery cron.*" \
    --label "bug,P0,e2e-failure,auto-discovered" 2>/dev/null || true
fi

# ───────────────────────────────────────────────
# Cleanup
# ───────────────────────────────────────────────
# Keep only last 10 reports
ls -t "$REPORT_DIR"/qa-*-smoke.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
ls -t "$REPORT_DIR"/qa-*-full.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

echo ""
echo "=== QA Discovery Complete ==="
echo "Report: $REPORT_DIR/$RUN_ID-full.json"
echo "Baseline: $BASELINE_FILE"
