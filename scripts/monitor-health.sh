#!/usr/bin/env bash
# Rekrut AI — External Health Check Monitor
# Monitors: Production, Staging, and Dev environments
# Runs every 5 minutes via cron
#
# Usage: ./scripts/monitor-health.sh
# Setup: */5 * * * * /root/.openclaw/workspace/Rekrut_AI_v2/scripts/monitor-health.sh

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/uptime"
ALERT_LOG="$LOG_DIR/alerts.log"
STATE_DIR="$LOG_DIR/state"

# URLs to monitor
URLS=(
  "https://rekrutai.co/health|production"
  "https://rekrutai-staging.onrender.com/health|staging"
  "https://rekrutai-dev.onrender.com/health|development"
)

# Alert thresholds
RESPONSE_TIME_WARNING_MS=3000   # 3 seconds
RESPONSE_TIME_CRITICAL_MS=5000 # 5 seconds
CONSECUTIVE_FAILURES_ALERT=2

# Ensure directories exist
mkdir -p "$LOG_DIR" "$STATE_DIR"

# Timestamp
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TODAY=$(date -u +"%Y-%m-%d")

# Daily log file
DAILY_LOG="$LOG_DIR/health-check-$TODAY.log"

# Helper: log with timestamp
log() {
  echo "[$TS] $1" | tee -a "$DAILY_LOG"
}

# Helper: send alert (logs to alert file; could be extended to Slack/email)
alert() {
  local level="$1"
  local message="$2"
  local alert_line="[$TS] [$level] $message"
  echo "$alert_line" | tee -a "$ALERT_LOG"
  # Optional: echo to stderr for cron email
  echo "$alert_line" >&2
}

# Track overall status for summary
all_ok=true

for entry in "${URLS[@]}"; do
  IFS='|' read -r url env_name <<< "$entry"
  
  # State file for this environment
  STATE_FILE="$STATE_DIR/$env_name.failures"
  RT_STATE="$STATE_DIR/$env_name.last_rt"
  
  # Initialize state files if missing
  [[ -f "$STATE_FILE" ]] || echo 0 > "$STATE_FILE"
  [[ -f "$RT_STATE" ]] || echo 0 > "$RT_STATE"
  
  failures=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  
  # Run health check
  http_code="000"
  response_time="0"
  body=""
  
  # Capture output and timing
  start_time=$(date +%s%N)
  
  if http_output=$(curl -s -o /dev/null -w "%{http_code}|%{time_total}" --max-time 15 "$url" 2>&1); then
    IFS='|' read -r http_code response_time <<< "$http_output"
    body=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "")
  else
    http_code="000"
    response_time="0"
    body=""
  fi
  
  # Convert response time to ms
  rt_ms=$(echo "$response_time * 1000" | bc 2>/dev/null || echo "0")
  rt_ms=${rt_ms%.*}
  
  # Determine status
  status="UNKNOWN"
  if [[ "$http_code" == "200" ]]; then
    if echo "$body" | grep -q '"status":"ok"'; then
      status="HEALTHY"
    else
      status="DEGRADED"
    fi
  elif [[ "$http_code" == "000" ]]; then
    status="DOWN"
  else
    status="ERROR"
  fi
  
  # Log result
  log "[$env_name] HTTP=$http_code RT=${rt_ms}ms Status=$status"
  
  # Update failure counter
  if [[ "$status" == "HEALTHY" ]]; then
    if [[ "$failures" -ge "$CONSECUTIVE_FAILURES_ALERT" ]]; then
      alert "RECOVERY" "$env_name is back up (was down for $failures consecutive checks)"
    fi
    echo 0 > "$STATE_FILE"
  else
    failures=$((failures + 1))
    echo "$failures" > "$STATE_FILE"
    
    if [[ "$failures" -ge "$CONSECUTIVE_FAILURES_ALERT" ]]; then
      alert "CRITICAL" "$env_name $status — HTTP $http_code after $failures consecutive failures (URL: $url)"
      all_ok=false
    elif [[ "$failures" -eq 1 ]]; then
      alert "WARNING" "$env_name first failure — HTTP $http_code (URL: $url)"
      all_ok=false
    fi
  fi
  
  # Response time warning (only when healthy)
  if [[ "$status" == "HEALTHY" && "$rt_ms" -gt "$RESPONSE_TIME_WARNING_MS" ]]; then
    if [[ "$rt_ms" -gt "$RESPONSE_TIME_CRITICAL_MS" ]]; then
      alert "CRITICAL" "$env_name response time ${rt_ms}ms exceeds ${RESPONSE_TIME_CRITICAL_MS}ms threshold"
    else
      alert "WARNING" "$env_name response time ${rt_ms}ms exceeds ${RESPONSE_TIME_WARNING_MS}ms threshold"
    fi
  fi
  
  # Save last response time for trend analysis
  echo "$rt_ms" > "$RT_STATE"
done

# Summary log
if $all_ok; then
  log "[SUMMARY] All environments healthy"
else
  log "[SUMMARY] One or more environments have issues — check alert log"
fi

# Cleanup old logs (keep 14 days)
find "$LOG_DIR" -name "health-check-*.log" -mtime +14 -delete 2>/dev/null || true

exit 0
