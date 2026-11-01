#!/usr/bin/env bash
# Stubbed tests for the HL-009 PG-rig bootstrap helper (issue #2077):
#   scripts/pg-rig-bootstrap.sh
#
# No real Postgres, no real users: `id`, `useradd`, `chmod`, `runuser`
# and `node` are stubbed via PATH; the Postgres binaries are fakes in a
# PG_BIN_DIR fixture dir (postgres / pg_ctl / pg_isready / psql /
# createdb / dropdb). Stub behaviour is driven by files in $STUB_STATE:
#   user_exists   -> `id -u gatepg` succeeds (uid 1000)
#   pg_ready      -> `pg_isready` reports accepting connections
# and env: STUB_NODE_RC, STUB_PGCTL_RC.
# Every stub call is appended to $STUB_LOG.
#
# Cases:
#   a. missing binaries (empty PG_BIN_DIR, empty HOME) -> exit 3,
#      output names the missing postgres binaries
#   b. port=abc            -> exit 2, names the bad value
#   c. port=overflow       -> exit 2, names the bad value
#   d. port=70000          -> exit 2, names the bad value
#   e. wait=xyz            -> exit 2, names the bad value
#   f. extra argument      -> exit 2, names the bad value
#   g. --help              -> exit 0
#   h. already listening   -> exit 0, ALREADY-RUNNING, stale pid KEPT,
#      useradd / pg_ctl NOT called
#   i. full bootstrap      -> exit 0, BOOTSTRAPPED + SELF-CHECK lines,
#      useradd + chmod o+x called, stale pid removed, pg_ctl started,
#      createdb + node migrate (DATABASE_URL on 127.0.0.1:<port> with
#      the throwaway db) + dropdb called, traverse dir gains o+x
#   j. migrate fails       -> exit 1, names the migrate/self-check
#      step, dropdb still attempted
#   k. user already exists -> exit 0, useradd NOT called
#   l. pg_ctl start fails  -> exit 1, names the start step
#   m. pg_isready rejects (exit 1, postmaster alive starting/recovering)
#      -> exit non-zero naming the state, pid KEPT, no pg_ctl call (B1)
#   n. recorded pid alive (ps stub reports it) -> exit non-zero,
#      pid KEPT, no pg_ctl call (B1)
#   o. already listening but psql select 1 fails -> exit non-zero
#      naming detect-existing, NO ALREADY-RUNNING (B2)
#   p. PG_RIG_UID=0          -> exit 2 naming the value (M1)
#   q. PG_RIG_UID=999999999  -> exit 2 naming the value (M1)
#   r. helper killed (TERM) between createdb and dropdb -> trap still
#      drops the throwaway db (M2: dropdb in stub log after kill)
#
# Prints PASS/FAIL per case; exits non-zero if any case fails.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
HELPER="$HERE/pg-rig-bootstrap.sh"
WORK="$(mktemp -d)"
FAILURES=0
trap 'rm -rf "$WORK"' EXIT

report() { # $1=0 pass / 1 fail, $2=label
  if [ "$1" -eq 0 ]; then echo "PASS: $2"; else echo "FAIL: $2"; FAILURES=$((FAILURES + 1)); fi
}

# --- stub bin (PATH) ---------------------------------------------------------
STUBBIN="$WORK/bin"
mkdir -p "$STUBBIN"

cat > "$STUBBIN/id" <<'SH'
#!/usr/bin/env bash
case " $* " in
  *" gatepg "*|*" gatepg")
    if [ -f "$STUB_STATE/user_exists" ]; then
      case " $* " in *" -u "*) printf '1000\n' ;; *) printf 'uid=1000(gatepg) gid=1000(gatepg)\n' ;; esac
      exit 0
    fi
    echo "id: 'gatepg': no such user" >&2; exit 1 ;;
  *)
    case " $* " in *" -u "*) printf '0\n' ;; *) printf 'uid=0(root) gid=0(root)\n' ;; esac
    exit 0 ;;
esac
SH

cat > "$STUBBIN/useradd" <<'SH'
#!/usr/bin/env bash
printf 'useradd %s\n' "$*" >> "$STUB_LOG"
touch "$STUB_STATE/user_exists"
exit 0
SH

cat > "$STUBBIN/chmod" <<'SH'
#!/usr/bin/env bash
printf 'chmod %s\n' "$*" >> "$STUB_LOG"
/bin/chmod "$@"
SH

cat > "$STUBBIN/runuser" <<'SH'
#!/usr/bin/env bash
printf 'runuser %s\n' "$*" >> "$STUB_LOG"
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
[ "$1" = "--" ] && shift
exec "$@"
SH

cat > "$STUBBIN/node" <<'SH'
#!/usr/bin/env bash
printf 'node %s DATABASE_URL=%s\n' "$*" "${DATABASE_URL:-}" >> "$STUB_LOG"
printf '%s\n' "${DATABASE_URL:-}" > "$STUB_STATE/node_database_url"
echo "stub migrate output"
[ -n "${STUB_NODE_SLEEP:-}" ] && sleep "$STUB_NODE_SLEEP"
exit "${STUB_NODE_RC:-0}"
SH

cat > "$STUBBIN/ps" <<'SH'
#!/usr/bin/env bash
printf 'ps %s\n' "$*" >> "$STUB_LOG"
# Stubbed liveness: alive only when the test arms pid_alive.
if [ -f "$STUB_STATE/pid_alive" ]; then exit 0; fi
exit 1
SH
chmod +x "$STUBBIN/"*

# --- fake PG bin dir -----------------------------------------------------------
PGBIN="$WORK/pgbin"
mkdir -p "$PGBIN"

cat > "$PGBIN/postgres" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = "--version" ] && echo "postgres (PostgreSQL) 18.6"
exit 0
SH

cat > "$PGBIN/pg_ctl" <<'SH'
#!/usr/bin/env bash
printf 'pg_ctl %s\n' "$*" >> "$STUB_LOG"
if [ -n "${STUB_PGCTL_RC:-}" ] && [ "$STUB_PGCTL_RC" != "0" ]; then exit "$STUB_PGCTL_RC"; fi
touch "$STUB_STATE/pg_ready"
exit 0
SH

cat > "$PGBIN/pg_isready" <<'SH'
#!/usr/bin/env bash
printf 'pg_isready %s\n' "$*" >> "$STUB_LOG"
if [ -f "$STUB_STATE/pg_rejecting" ]; then echo "127.0.0.1:55442 - rejecting connections"; exit 1; fi
if [ -f "$STUB_STATE/pg_ready" ]; then echo "127.0.0.1:55442 - accepting connections"; exit 0; fi
echo "127.0.0.1:55442 - no response"; exit 2
SH

cat > "$PGBIN/psql" <<'SH'
#!/usr/bin/env bash
printf 'psql %s\n' "$*" >> "$STUB_LOG"
if [ -f "$STUB_STATE/psql_fails" ]; then echo "psql: error: connection failed / auth failed" >&2; exit 1; fi
echo "1"
exit 0
SH

cat > "$PGBIN/createdb" <<'SH'
#!/usr/bin/env bash
printf 'createdb %s\n' "$*" >> "$STUB_LOG"
exit 0
SH

cat > "$PGBIN/dropdb" <<'SH'
#!/usr/bin/env bash
printf 'dropdb %s\n' "$*" >> "$STUB_LOG"
exit 0
SH
chmod +x "$PGBIN/"*

# --- fixture rig ---------------------------------------------------------------
make_fixture() { # $1=case dir; sets RIG, TRAV, REPO, STATE, LOGF
  RIG="$1/rig"; TRAV="$1/trav"; REPO="$1/repo"; STATE="$1/state"; LOGF="$1/stub.log"
  mkdir -p "$RIG/data" "$RIG/sock" "$TRAV" "$REPO" "$STATE"
  printf '18\n' > "$RIG/data/PG_VERSION"
  printf '999999\n%s/data\n' "$RIG" > "$RIG/data/postmaster.pid"
  printf '// stub migrate\n' > "$REPO/migrate.js"
  /bin/chmod 770 "$TRAV"
  : > "$LOGF"
}

run_helper() { # $1=case dir, rest = helper args; sets RC, OUT. Env passthrough: STUB_NODE_RC etc.
  local dir="$1"; shift
  OUT="$(cd "$dir/repo" && \
    STUB_STATE="$dir/state" STUB_LOG="$dir/stub.log" \
    PG_BIN_DIR="$PGBIN" PG_RIG_HOME="$dir/rig" PG_RIG_REPO_DIR="$dir/repo" \
    PG_RIG_TRAVERSE_DIR="$dir/trav" \
    PATH="$STUBBIN:$PGBIN:/usr/bin:/bin" \
    bash "$HELPER" "$@" 2>&1)"
  RC=$?
}

# --- a. missing binaries -> exit 3 naming postgres ----------------------------
D="$WORK/a"; make_fixture "$D"
OUT="$(STUB_STATE="$D/state" STUB_LOG="$D/stub.log" HOME="$D/nohome" \
  PG_BIN_DIR="$D/emptybin" PG_RIG_HOME="$D/rig" PG_RIG_REPO_DIR="$D/repo" PG_RIG_TRAVERSE_DIR="$D/trav" \
  PATH="$STUBBIN:/usr/bin:/bin" bash "$HELPER" 55442 5 2>&1)"; RC=$?
ok=0; { [ "$RC" -eq 3 ] && printf '%s' "$OUT" | grep -qi 'postgres' && printf '%s' "$OUT" | grep -q 'locate-binaries'; } || ok=1
report "$ok" "a missing binaries -> exit 3 naming missing piece (rc=$RC out=$(printf '%s' "$OUT" | head -1))"

# --- b. port=abc -> exit 2 naming value ----------------------------------------
D="$WORK/b"; make_fixture "$D"; run_helper "$D" abc 5
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'abc'"; } || ok=1
report "$ok" "b port=abc -> exit 2 naming bad value (rc=$RC)"

# --- c. port overflow -> exit 2 naming value -----------------------------------
D="$WORK/c"; make_fixture "$D"; run_helper "$D" 99999999999999999999999999 5
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'99999999999999999999999999'"; } || ok=1
report "$ok" "c port=overflow -> exit 2 naming bad value (rc=$RC)"

# --- d. port=70000 -> exit 2 naming value ---------------------------------------
D="$WORK/d"; make_fixture "$D"; run_helper "$D" 70000 5
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'70000'"; } || ok=1
report "$ok" "d port=70000 -> exit 2 naming bad value (rc=$RC)"

# --- e. wait=xyz -> exit 2 naming value -----------------------------------------
D="$WORK/e"; make_fixture "$D"; run_helper "$D" 55442 xyz
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'xyz'"; } || ok=1
report "$ok" "e wait=xyz -> exit 2 naming bad value (rc=$RC)"

# --- f. extra arg -> exit 2 naming value ----------------------------------------
D="$WORK/f"; make_fixture "$D"; run_helper "$D" 55442 5 extra
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'extra'"; } || ok=1
report "$ok" "f extra arg -> exit 2 naming bad value (rc=$RC)"

# --- g. --help -> exit 0 ----------------------------------------------------------
OUT="$(bash "$HELPER" --help 2>&1)"; RC=$?
ok=0; [ "$RC" -eq 0 ] || ok=1
report "$ok" "g --help -> exit 0 (rc=$RC)"

# --- h. already listening -> exit 0 ALREADY-RUNNING, no useradd/pg_ctl, pid kept --
D="$WORK/h"; make_fixture "$D"; touch "$D/state/pg_ready"
run_helper "$D" 55442 5
ok=0; { [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qx 'ALREADY-RUNNING' \
  && [ -f "$D/rig/data/postmaster.pid" ] \
  && ! grep -q '^useradd' "$D/stub.log" && ! grep -q '^pg_ctl' "$D/stub.log"; } || ok=1
report "$ok" "h already listening -> exit 0 ALREADY-RUNNING, pid kept, no useradd/pg_ctl (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; fi

# --- i. full bootstrap -> exit 0 BOOTSTRAPPED --------------------------------------
D="$WORK/i"; make_fixture "$D"
run_helper "$D" 55442 5
travmode="$(stat -c %a "$D/trav")"
nodeurl="$(cat "$D/state/node_database_url" 2>/dev/null)"
ok=0; { [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qx 'BOOTSTRAPPED' \
  && printf '%s' "$OUT" | grep -q 'SELF-CHECK migrate exit=0' \
  && grep -q '^useradd' "$D/stub.log" && grep -q '^chmod o+x' "$D/stub.log" \
  && grep -q '^pg_ctl' "$D/stub.log" && grep -q '^createdb' "$D/stub.log" \
  && grep -q '^dropdb' "$D/stub.log" \
  && [ ! -f "$D/rig/data/postmaster.pid" ] \
  && case "$travmode" in *1|*3|*5|*7) true ;; *) false ;; esac \
  && printf '%s' "$nodeurl" | grep -q '^postgresql://postgres@127.0.0.1:55442/pg_rig_selfcheck_'; } || ok=1
report "$ok" "i full bootstrap -> exit 0 BOOTSTRAPPED, useradd+chmod+pg_ctl+migrate+drop, pid removed, trav o+x (rc=$RC trav=$travmode)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; echo "  nodeurl: $nodeurl"; fi

# --- j. migrate fails -> exit 1 naming migrate step, dropdb attempted ---------------
D="$WORK/j"; make_fixture "$D"
STUB_NODE_RC=1 run_helper "$D" 55442 5
ok=0; { [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q 'self-check-migrate' \
  && grep -q '^dropdb' "$D/stub.log"; } || ok=1
report "$ok" "j migrate fails -> exit 1 naming self-check-migrate, dropdb attempted (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; fi

# --- k. user already exists -> exit 0, no useradd ------------------------------------
D="$WORK/k"; make_fixture "$D"; touch "$D/state/user_exists"
run_helper "$D" 55442 5
ok=0; { [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -qx 'BOOTSTRAPPED' \
  && ! grep -q '^useradd' "$D/stub.log"; } || ok=1
report "$ok" "k user exists -> exit 0 BOOTSTRAPPED, no useradd (rc=$RC)"

# --- l. pg_ctl start fails -> exit 1 naming start step --------------------------------
D="$WORK/l"; make_fixture "$D"
STUB_PGCTL_RC=1 run_helper "$D" 55442 5
ok=0; { [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q 'start-cluster'; } || ok=1
report "$ok" "l pg_ctl fails -> exit 1 naming start-cluster (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; fi

# --- m. pg_isready rejecting (exit 1) -> refuse, pid kept, no pg_ctl (B1) -------------
D="$WORK/m"; make_fixture "$D"; touch "$D/state/pg_rejecting"
run_helper "$D" 55442 5
ok=0; { [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi 'rejecting' \
  && [ -f "$D/rig/data/postmaster.pid" ] \
  && ! grep -q '^pg_ctl' "$D/stub.log"; } || ok=1
report "$ok" "m isready exit1 rejecting -> exit non-zero naming state, pid kept, no pg_ctl (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; fi

# --- n. recorded pid alive (ps stub) -> refuse, pid kept, no pg_ctl (B1) ---------------
D="$WORK/n"; make_fixture "$D"; touch "$D/state/pid_alive"
run_helper "$D" 55442 5
ok=0; { [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi 'alive' \
  && [ -f "$D/rig/data/postmaster.pid" ] \
  && ! grep -q '^pg_ctl' "$D/stub.log"; } || ok=1
report "$ok" "n recorded pid alive -> exit non-zero, pid kept, no pg_ctl (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; fi

# --- o. listening but psql fails -> refuse, no ALREADY-RUNNING (B2) ---------------------
D="$WORK/o"; make_fixture "$D"; touch "$D/state/pg_ready" "$D/state/psql_fails"
run_helper "$D" 55442 5
ok=0; { [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q 'detect-existing' \
  && ! printf '%s' "$OUT" | grep -qx 'ALREADY-RUNNING' \
  && ! grep -q '^pg_ctl' "$D/stub.log"; } || ok=1
report "$ok" "o psql proof fails -> exit non-zero naming detect-existing, no ALREADY-RUNNING (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; fi

# --- p. PG_RIG_UID=0 -> exit 2 naming value (M1) -----------------------------------------
D="$WORK/p"; make_fixture "$D"
OUT="$(STUB_STATE="$D/state" STUB_LOG="$D/stub.log" PG_RIG_UID=0 \
  PG_BIN_DIR="$PGBIN" PG_RIG_HOME="$D/rig" PG_RIG_REPO_DIR="$D/repo" PG_RIG_TRAVERSE_DIR="$D/trav" \
  PATH="$STUBBIN:$PGBIN:/usr/bin:/bin" bash "$HELPER" 55442 5 2>&1)"; RC=$?
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -q "PG_RIG_UID" && printf '%s' "$OUT" | grep -qF "'0'"; } || ok=1
report "$ok" "p PG_RIG_UID=0 -> exit 2 naming value (rc=$RC)"

# --- q. PG_RIG_UID=999999999 -> exit 2 naming value (M1) ----------------------------------
D="$WORK/q"; make_fixture "$D"
OUT="$(STUB_STATE="$D/state" STUB_LOG="$D/stub.log" PG_RIG_UID=999999999 \
  PG_BIN_DIR="$PGBIN" PG_RIG_HOME="$D/rig" PG_RIG_REPO_DIR="$D/repo" PG_RIG_TRAVERSE_DIR="$D/trav" \
  PATH="$STUBBIN:$PGBIN:/usr/bin:/bin" bash "$HELPER" 55442 5 2>&1)"; RC=$?
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'999999999'"; } || ok=1
report "$ok" "q PG_RIG_UID=999999999 -> exit 2 naming value (rc=$RC)"

# --- r. killed (TERM) mid self-check -> trap drops throwaway db (M2) ----------------------
D="$WORK/r"; make_fixture "$D"
STUB_STATE="$D/state" STUB_LOG="$D/stub.log" STUB_NODE_SLEEP=30 \
  PG_BIN_DIR="$PGBIN" PG_RIG_HOME="$D/rig" PG_RIG_REPO_DIR="$D/repo" PG_RIG_TRAVERSE_DIR="$D/trav" \
  PATH="$STUBBIN:$PGBIN:/usr/bin:/bin" setsid bash "$HELPER" 55442 5 > "$D/out.txt" 2>&1 &
rpid=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do grep -q '^node ' "$D/stub.log" 2>/dev/null && break; sleep 0.25; done
# Kill the whole process group (operator kill / Ctrl-C analogue): the
# sleeping migrate dies with the helper, the helper's TERM/EXIT traps
# must still drop the throwaway db.
kill -TERM -"$rpid" 2>/dev/null || kill -TERM "$rpid" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do grep -q '^dropdb' "$D/stub.log" 2>/dev/null && break; sleep 0.5; done
wait "$rpid" 2>/dev/null; sleep 0.5
ok=0; { grep -q '^createdb' "$D/stub.log" && grep -q '^dropdb' "$D/stub.log"; } || ok=1
report "$ok" "r killed mid self-check -> trap drops throwaway db (dropdb in log)"
if [ "$ok" -ne 0 ]; then cat "$D/out.txt" 2>/dev/null | sed 's/^/  out: /'; cat "$D/stub.log" | sed 's/^/  log: /'; fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "ALL PASS"; else echo "$FAILURES FAILURE(S)"; exit 1; fi
