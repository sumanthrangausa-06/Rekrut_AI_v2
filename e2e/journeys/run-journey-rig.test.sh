#!/usr/bin/env bash
# Pin test for run-journey-rig.sh (issue #2069).
#
# Builds a fake repo in a temp dir, copies the REAL launcher into it,
# and runs it against a stub server.js (switchable /health DB state,
# optional SIGTERM-ignoring mode) and stub journey suites. Asserts:
#   a. invalid suite name   -> exit 2 in <5s, server never spawned
#   b. non-numeric port     -> exit 2 in <5s, server never spawned
#   c. degraded health (DB disconnected) -> exit 2, suites never run
#   d. healthy -> suites run, suite exit code propagates (0 and 1)
#   e. SIGTERM-ignoring server -> launcher still exits in <20s and
#      the stub server process is dead afterwards
#
# Prints PASS/FAIL per case; exits non-zero if any case fails.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
FAKE="$(mktemp -d)"
MARKS="$(mktemp -d)"
FAILURES=0

kill_strays() {
  for f in "$MARKS"/*.spawn; do
    [ -f "$f" ] || continue
    pid="$(cat "$f" 2>/dev/null)"
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  done
}
cleanup_test() {
  kill_strays
  rm -rf "$FAKE" "$MARKS"
}
trap cleanup_test EXIT

mkdir -p "$FAKE/e2e/journeys"
cp "$HERE/run-journey-rig.sh" "$FAKE/e2e/journeys/run-journey-rig.sh"
chmod +x "$FAKE/e2e/journeys/run-journey-rig.sh"

cat > "$FAKE/server.js" <<'JS'
const http = require('http');
const fs = require('fs');
if (process.env.STUB_MARKER) fs.writeFileSync(process.env.STUB_MARKER, String(process.pid));
if (process.env.STUB_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
const connected = process.env.STUB_DB_CONNECTED === 'true';
const srv = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: connected ? 'ok' : 'degraded', db: { connected } }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
// Raw PORT (no Number()): mirrors server.js — a non-numeric value
// becomes a unix-socket listener and the process stays alive.
srv.listen(process.env.PORT, '127.0.0.1');
JS

for suite in candidate recruiter; do
  cat > "$FAKE/e2e/journeys/$suite-journey.js" <<'JS'
const fs = require('fs');
if (process.env.STUB_SUITE_MARKER) fs.writeFileSync(process.env.STUB_SUITE_MARKER, 'ran');
process.exit(Number(process.env.STUB_SUITE_EXIT || 0));
JS
done

LAUNCHER="$FAKE/e2e/journeys/run-journey-rig.sh"
export DATABASE_URL='postgresql://stub:stub@127.0.0.1/stub'

report() { # $1=0 pass / 1 fail, $2=label
  if [ "$1" -eq 0 ]; then
    echo "PASS: $2"
  else
    echo "FAIL: $2"
    FAILURES=$((FAILURES + 1))
  fi
}

now_ms() { date +%s%3N; }

# --- a. invalid suite name -------------------------------------------------
start="$(now_ms)"
STUB_MARKER="$MARKS/a.spawn" STUB_SUITE_MARKER="$MARKS/a.suite" STUB_DB_CONNECTED=true \
  timeout -k 2 10 bash "$LAUNCHER" bogus 3411 >"$MARKS/a.log" 2>&1
rc=$?
elapsed=$(( $(now_ms) - start ))
ok=0
{ [ "$rc" -eq 2 ] && [ "$elapsed" -lt 5000 ] && [ ! -e "$MARKS/a.spawn" ]; } || ok=1
report "$ok" "a invalid suite -> exit 2 in <5s, no spawn (rc=$rc elapsed=${elapsed}ms spawn_marker=$([ -e "$MARKS/a.spawn" ] && echo present || echo absent))"
kill_strays

# --- b. non-numeric port ---------------------------------------------------
start="$(now_ms)"
STUB_MARKER="$MARKS/b.spawn" STUB_SUITE_MARKER="$MARKS/b.suite" STUB_DB_CONNECTED=true \
  timeout -k 2 10 bash "$LAUNCHER" candidate abc >"$MARKS/b.log" 2>&1
rc=$?
elapsed=$(( $(now_ms) - start ))
ok=0
{ [ "$rc" -eq 2 ] && [ "$elapsed" -lt 5000 ] && [ ! -e "$MARKS/b.spawn" ]; } || ok=1
report "$ok" "b non-numeric port -> exit 2 in <5s, no spawn (rc=$rc elapsed=${elapsed}ms spawn_marker=$([ -e "$MARKS/b.spawn" ] && echo present || echo absent))"
kill_strays

# --- c. degraded health: DB disconnected -----------------------------------
start="$(now_ms)"
STUB_MARKER="$MARKS/c.spawn" STUB_SUITE_MARKER="$MARKS/c.suite" STUB_DB_CONNECTED=false JOURNEY_HEALTH_TRIES=3 \
  timeout -k 2 15 bash "$LAUNCHER" candidate 3413 >"$MARKS/c.log" 2>&1
rc=$?
elapsed=$(( $(now_ms) - start ))
ok=0
{ [ "$rc" -eq 2 ] && [ ! -e "$MARKS/c.suite" ]; } || ok=1
report "$ok" "c degraded health -> exit 2, suites never run (rc=$rc elapsed=${elapsed}ms suite_marker=$([ -e "$MARKS/c.suite" ] && echo present || echo absent))"
kill_strays

# --- d1. healthy, suite exit 0 ---------------------------------------------
STUB_MARKER="$MARKS/d1.spawn" STUB_SUITE_MARKER="$MARKS/d1.suite" STUB_DB_CONNECTED=true STUB_SUITE_EXIT=0 \
  timeout -k 2 15 bash "$LAUNCHER" candidate 3414 >"$MARKS/d1.log" 2>&1
rc=$?
ok=0
{ [ "$rc" -eq 0 ] && [ -e "$MARKS/d1.suite" ]; } || ok=1
report "$ok" "d1 healthy + suite exit 0 -> launcher exit 0, suite ran (rc=$rc suite_marker=$([ -e "$MARKS/d1.suite" ] && echo present || echo absent))"
kill_strays

# --- d2. healthy, suite exit 1 ---------------------------------------------
STUB_MARKER="$MARKS/d2.spawn" STUB_SUITE_MARKER="$MARKS/d2.suite" STUB_DB_CONNECTED=true STUB_SUITE_EXIT=1 \
  timeout -k 2 15 bash "$LAUNCHER" candidate 3415 >"$MARKS/d2.log" 2>&1
rc=$?
ok=0
{ [ "$rc" -eq 1 ] && [ -e "$MARKS/d2.suite" ]; } || ok=1
report "$ok" "d2 healthy + suite exit 1 -> launcher exit 1, suite ran (rc=$rc suite_marker=$([ -e "$MARKS/d2.suite" ] && echo present || echo absent))"
kill_strays

# --- e. SIGTERM-ignoring server --------------------------------------------
start="$(now_ms)"
STUB_MARKER="$MARKS/e.spawn" STUB_SUITE_MARKER="$MARKS/e.suite" STUB_DB_CONNECTED=true STUB_SUITE_EXIT=0 STUB_IGNORE_TERM=1 \
  timeout -k 2 25 bash "$LAUNCHER" candidate 3416 >"$MARKS/e.log" 2>&1
rc=$?
elapsed=$(( $(now_ms) - start ))
server_pid="$(cat "$MARKS/e.spawn" 2>/dev/null)"
server_dead=1
if [ -n "$server_pid" ] && ! kill -0 "$server_pid" 2>/dev/null; then server_dead=0; fi
ok=0
{ [ "$rc" -eq 0 ] && [ "$elapsed" -lt 20000 ] && [ "$server_dead" -eq 0 ]; } || ok=1
report "$ok" "e SIGTERM-ignoring server -> launcher exit 0 in <20s, server dead (rc=$rc elapsed=${elapsed}ms server_pid=${server_pid:-none} server_dead=$([ "$server_dead" -eq 0 ] && echo yes || echo no))"
kill_strays

if [ "$FAILURES" -eq 0 ]; then
  echo "ALL PASS"
else
  echo "$FAILURES case(s) FAILED"
fi
exit "$FAILURES"
