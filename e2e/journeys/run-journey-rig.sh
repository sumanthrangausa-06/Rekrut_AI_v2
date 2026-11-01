#!/usr/bin/env bash
# Canonical fresh-install journey rig launcher (issue #1672, item 1).
#
# WHY THIS EXISTS: server.js binds its HTTP listener ONLY when
# NODE_ENV !== 'test' (the `app.listen` gate at the end of server.js —
# it exists so jest integration tests can import the app without
# binding a port). Per-gate harness copies that spawned the server
# with NODE_ENV=test therefore waited forever for a server that could
# never come up ("server did not come up"). This launcher is the ONE
# canonical rig shape: it pins NODE_ENV=development for the spawned
# server, waits for a real /health 200 reporting the DB connected,
# runs the suite, and always kills the server it started. Do not
# copy-paste new harness shapes — extend this one.
#
# Usage:
#   DATABASE_URL=postgresql://postgres@127.0.0.1:<pg-port>/<db> \
#     ./run-journey-rig.sh [candidate|recruiter|both] [port]
#
# Env:
#   JOURNEY_HEALTH_TRIES — number of /health attempts before giving
#     up (default 40, i.e. today's window at the 2s poll interval).
#     An attempt only counts as healthy on HTTP 200 with the body
#     reporting the DB connected ("connected":true).
#
# The database must already exist and be built ONLY by `node migrate.js`
# (see README.md steps 1–2). The launcher refuses to run the suites
# against a server that does not answer /health, and propagates the
# suite exit code (1 when any step FAILs; BLOCKED does not fail).
set -u
cd "$(dirname "$0")/../.." || exit 2

SUITE="${1:-both}"
PORT="${2:-3211}"

# Validate arguments BEFORE the DATABASE_URL check and before any
# spawn: a typo'd invocation fails instantly instead of booting the
# server (suite) or burning the whole health window (port).
case "$SUITE" in
  candidate|recruiter|both) ;;
  *) echo "usage: $0 [candidate|recruiter|both] [port]" >&2; exit 2 ;;
esac
case "$PORT" in
  ''|*[!0-9]*) echo "usage: $0 [candidate|recruiter|both] [port]" >&2; exit 2 ;;
esac
# Range check (issue #2071): digits alone are not enough — PORT=0 binds
# an ephemeral port and burns the whole health window before failing.
# Strip leading zeros first so the -lt/-gt tests read the value as
# plain decimal and a long digit string cannot overflow them.
PORT_NUM="${PORT#${PORT%%[!0]*}}"
PORT_NUM="${PORT_NUM:-0}"
if [ "${#PORT_NUM}" -gt 5 ] || [ "$PORT_NUM" -lt 1 ] || [ "$PORT_NUM" -gt 65535 ]; then
  echo "usage: $0 [candidate|recruiter|both] [port] — port must be 1-65535 (got '$PORT')" >&2; exit 2
fi
# JOURNEY_HEALTH_TRIES check (issue #2071): an unvalidated non-numeric
# value made seq fail, the health loop ran zero times, and the launcher
# blamed the server ("did not answer in time") instead of the typo.
JOURNEY_HEALTH_TRIES="${JOURNEY_HEALTH_TRIES:-40}"
case "$JOURNEY_HEALTH_TRIES" in
  ''|*[!0-9]*) echo "usage: JOURNEY_HEALTH_TRIES must be a positive integer (got '$JOURNEY_HEALTH_TRIES')" >&2; exit 2 ;;
esac
TRIES_NUM="${JOURNEY_HEALTH_TRIES#${JOURNEY_HEALTH_TRIES%%[!0]*}}"
if [ -z "$TRIES_NUM" ]; then
  echo "usage: JOURNEY_HEALTH_TRIES must be a positive integer (got '$JOURNEY_HEALTH_TRIES')" >&2; exit 2
fi

: "${DATABASE_URL:?DATABASE_URL must point at the fresh-install rig database (built by node migrate.js)}"

# Local-rig-only fallbacks so a bare checkout can boot; real service
# keys from the caller's environment always win.
export JWT_SECRET="${JWT_SECRET:-local-rig-only-not-a-real-secret}"
export SESSION_SECRET="${SESSION_SECRET:-local-rig-only-not-a-real-secret}"

LOG="$(mktemp -t journey-rig-server-XXXXXX.log)"
NODE_ENV=development PORT="$PORT" DATABASE_URL="$DATABASE_URL" \
  node server.js >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  # Bounded grace (~5s): poll until the server is gone, then SIGKILL
  # as a backstop so a server that ignores SIGTERM cannot hang us.
  for _ in $(seq 1 50); do
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 0.1
  done
  kill -9 "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT

echo "[rig] waiting for /health on port $PORT (server log: $LOG)"
healthy=""
for _ in $(seq 1 "${JOURNEY_HEALTH_TRIES:-40}"); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[rig] server process exited before becoming healthy — log tail:" >&2
    tail -20 "$LOG" >&2
    exit 2
  fi
  # Capture the body, not just the status: /health answers 200 even
  # when degraded, so health requires the body to report the DB
  # connected ("connected":true, tolerating a space after the colon).
  out="$(curl -s -m 3 -w '\n%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null)"
  code="$(printf '%s' "$out" | tail -n 1)"
  body="$(printf '%s' "$out" | sed '$d')"
  if [ "$code" = "200" ]; then
    case "$body" in
      *'"connected":true'*|*'"connected": true'*) healthy=1; break ;;
    esac
  fi
  sleep 2
done
if [ -z "$healthy" ]; then
  echo "[rig] server did not answer /health 200 with DB connected in time — log tail:" >&2
  tail -20 "$LOG" >&2
  exit 2
fi
echo "[rig] server healthy on port $PORT"

export JOURNEY_BASE_URL="http://127.0.0.1:$PORT"
export JOURNEY_DB_URL="$DATABASE_URL"

status=0
run_suite() {
  echo "[rig] running $1"
  node "e2e/journeys/$1" || status=1
}
case "$SUITE" in
  candidate) run_suite candidate-journey.js ;;
  recruiter) run_suite recruiter-journey.js ;;
  both) run_suite candidate-journey.js; run_suite recruiter-journey.js ;;
  *) echo "usage: $0 [candidate|recruiter|both] [port]" >&2; exit 2 ;;
esac
exit "$status"
