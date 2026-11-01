#!/usr/bin/env bash
# PG-rig bootstrap helper (HL-009, issue #2077).
#
# Usage: pg-rig-bootstrap.sh [port=55442] [wait-sec=30]
#
# Recovers the persistent local E2E Postgres rig after a VM restart:
#   1. detects an already-listening instance on the port and exits 0
#      with proof (pg_isready accepting AND psql select 1 returning
#      exactly 1; anything less fails named — never ALREADY-RUNNING
#      without proof, and a rejecting-connections postmaster (alive,
#      starting/recovering) is refused, never disturbed);
#   2. recreates the rig user (default gatepg, uid 1000) if missing;
#   3. ensures the traversal dir (default /home/hatch) has o+x so the
#      rig user can reach its data dir;
#   4. removes a stale data/postmaster.pid — only when pg_isready
#      reports no response AND the recorded pid is not alive
#      (kill -0 / ps check); a live recorded pid is refused named;
#   5. starts the persistent cluster (default
#      ~/workspace/pg-gate-2034, PG 18) as the rig user;
#   6. self-checks: creates a throwaway DB, runs `node migrate.js`
#      from the repo against it, requires exit 0, drops the DB, and
#      prints the evidence.
#
# Local rig ONLY — never Neon / staging / production / any shared DB.
# Test-infrastructure: no product code, no schema authored here.
#
# Privileged steps (enumerated for gate review): `useradd` for the
# rig user, `chmod o+x` (traverse-only, not read/list) on the
# traversal dir, and starting postgres as the rig user via runuser.
#
# Binaries are NOT in the rig dir. They are located by trying, in
# order: $PG_BIN_DIR, the `postgres` on PATH, the known PGDG-deb
# extraction trees (~/workspace/pgfull, /tmp/pgrig*), system paths.
# Extraction trees need their bundled libs: for a
# .../usr/lib/postgresql/<v>/bin layout the matching
# .../usr/lib/x86_64-linux-gnu is prepended to LD_LIBRARY_PATH.
# If no working binaries are found the helper says so and exits 3
# naming the missing piece — it downloads nothing.
#
# Env overrides (also how the stubbed tests drive it):
#   PG_BIN_DIR, PG_RIG_HOME, PG_RIG_USER (gatepg), PG_RIG_UID (1000),
#   PG_RIG_TRAVERSE_DIR (/home/hatch), PG_RIG_REPO_DIR (repo root —
#   parent of this script's dir), PG_RIG_LOG (default $RIG_HOME/pg.log)
#
# Exit: 0 = rig ready (ALREADY-RUNNING or BOOTSTRAPPED),
#       1 = a named step failed, 2 = bad arguments,
#       3 = PostgreSQL binaries not locatable.
set -u

usage() {
  echo "Usage: pg-rig-bootstrap.sh [port=55442] [wait-sec=30]" >&2
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage; exit 0
fi

port="${1:-55442}"
wait_sec="${2:-30}"

if [ "$#" -gt 2 ]; then
  echo "error: unexpected argument '$3'" >&2; usage; exit 2
fi
case "$port" in
  ''|*[!0-9]*)
    echo "error: port must be a positive integer, got '$port'" >&2; usage; exit 2 ;;
esac
# Bound digit length before any integer test (a >int64 value makes
# `[ -lt ]` error out and fall through — review B1 on PR #2074).
if [ "${#port}" -gt 9 ]; then
  echo "error: port must be a positive integer, got '$port'" >&2; usage; exit 2
fi
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "error: port must be between 1 and 65535, got '$port'" >&2; usage; exit 2
fi
case "$wait_sec" in
  ''|*[!0-9]*)
    echo "error: wait-sec must be a positive integer, got '$wait_sec'" >&2; usage; exit 2 ;;
esac
if [ "${#wait_sec}" -gt 9 ]; then
  echo "error: wait-sec must be a positive integer, got '$wait_sec'" >&2; usage; exit 2
fi
if [ "$wait_sec" -lt 1 ] || [ "$wait_sec" -gt 300 ]; then
  echo "error: wait-sec must be between 1 and 300, got '$wait_sec'" >&2; usage; exit 2
fi

RIG_HOME="${PG_RIG_HOME:-$HOME/workspace/pg-gate-2034}"
DATA_DIR="$RIG_HOME/data"
SOCK_DIR="$RIG_HOME/sock"
LOG_FILE="${PG_RIG_LOG:-$RIG_HOME/pg.log}"
RIG_USER="${PG_RIG_USER:-gatepg}"
RIG_UID="${PG_RIG_UID:-1000}"
TRAVERSE_DIR="${PG_RIG_TRAVERSE_DIR:-/home/hatch}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${PG_RIG_REPO_DIR:-$(dirname "$SCRIPT_DIR")}"

case "$RIG_UID" in
  ''|*[!0-9]*)
    echo "error: PG_RIG_UID must be a positive integer, got '$RIG_UID'" >&2; exit 2 ;;
esac
if [ "${#RIG_UID}" -gt 9 ]; then
  echo "error: PG_RIG_UID must be a positive integer, got '$RIG_UID'" >&2; exit 2
fi
if [ "$RIG_UID" -lt 1 ] || [ "$RIG_UID" -gt 65534 ]; then
  echo "error: PG_RIG_UID must be between 1 and 65534, got '$RIG_UID'" >&2; exit 2
fi

fail() { # $1=step $2=message
  echo "error: step $1: $2" >&2
  exit 1
}

# --- step locate-binaries ------------------------------------------------------
candidates=()
[ -n "${PG_BIN_DIR:-}" ] && candidates+=("$PG_BIN_DIR")
path_postgres="$(command -v postgres 2>/dev/null)"
[ -n "$path_postgres" ] && candidates+=("$(dirname "$path_postgres")")
candidates+=("$HOME/workspace/pgfull/root/usr/lib/postgresql/18/bin")
for d in "$HOME"/workspace/pgfull/root/usr/lib/postgresql/*/bin \
         /tmp/pgrig*/root/usr/lib/postgresql/*/bin \
         /usr/lib/postgresql/*/bin; do
  [ -d "$d" ] && candidates+=("$d")
done
candidates+=("/usr/local/pg-build/bin" "/home/pguser/pgbin")

PGBIN=""
PG_LD=""
PG_VERSION_OUT=""
for d in "${candidates[@]}"; do
  [ -n "$d" ] || continue
  ok=1
  for b in postgres pg_ctl pg_isready psql createdb dropdb; do
    [ -x "$d/$b" ] || { ok=0; break; }
  done
  [ "$ok" -eq 1 ] || continue
  ld=""
  case "$d" in
    */usr/lib/postgresql/*/bin)
      prefix="${d%/usr/lib/postgresql/*/bin}"
      [ -d "$prefix/usr/lib/x86_64-linux-gnu" ] && ld="$prefix/usr/lib/x86_64-linux-gnu" ;;
  esac
  for try_ld in "$ld" ""; do
    out="$(LD_LIBRARY_PATH="${try_ld}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$d/postgres" --version 2>/dev/null)"
    if [ -n "$out" ]; then PGBIN="$d"; PG_LD="$try_ld"; PG_VERSION_OUT="$out"; break 2; fi
  done
done

if [ -z "$PGBIN" ]; then
  echo "error: step locate-binaries: no working PostgreSQL binaries found; missing piece: postgres/pg_ctl/pg_isready/psql/createdb/dropdb (PG 18) — looked in: ${candidates[*]:-(none)}; extract the PGDG debs (see TOOLS.md) or set PG_BIN_DIR" >&2
  exit 3
fi
if [ -n "$PG_LD" ]; then
  export LD_LIBRARY_PATH="$PG_LD${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
echo "step locate-binaries: $PGBIN/postgres --version -> $PG_VERSION_OUT"

pg_isready() { "$PGBIN/pg_isready" -h 127.0.0.1 -p "$port" -t 2 2>/dev/null; }

pid_alive() { # $1=pid — kill -0 first, ps as the stubbable second check
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null && return 0
  if command -v ps >/dev/null 2>&1 && ps -p "$1" >/dev/null 2>&1; then return 0; fi
  return 1
}

# --- step detect-existing --------------------------------------------------------
# pg_isready exit codes: 0 = accepting, 1 = rejecting connections
# (postmaster ALIVE, starting up / in WAL recovery), 2 = no response,
# 3 = no attempt (bad args). Only exit 2 may proceed to bootstrap.
ready_out="$(pg_isready)"; ready_rc=$?
if [ "$ready_rc" -eq 0 ]; then
  echo "step detect-existing: pg_isready: $ready_out"
  one="$("$PGBIN/psql" -h 127.0.0.1 -p "$port" -U postgres -d postgres -tAc 'select 1' 2>/dev/null)"; psql_rc=$?
  if [ "$psql_rc" -ne 0 ] || [ "$one" != "1" ]; then
    fail "detect-existing" "a server accepts connections on 127.0.0.1:$port but psql select 1 did not prove it is this rig (psql exit $psql_rc, result '${one:-<empty>}') — it could be a foreign cluster or an auth failure for -U postgres/-d postgres; refusing to report ALREADY-RUNNING and refusing to bootstrap against an occupied port"
  fi
  echo "step detect-existing: psql select 1 -> $one"
  echo "ALREADY-RUNNING"
  exit 0
fi
if [ "$ready_rc" -eq 1 ]; then
  fail "detect-existing" "pg_isready reports 127.0.0.1:$port is rejecting connections (exit 1) — a postmaster is alive and starting up or in recovery ('$ready_out'); refusing to remove postmaster.pid or start another postmaster; wait for it to finish starting and re-run"
fi
if [ "$ready_rc" -ne 2 ]; then
  fail "detect-existing" "pg_isready exited $ready_rc ('$ready_out') — not the no-response state; refusing to bootstrap"
fi
echo "step detect-existing: nothing listening on 127.0.0.1:$port (pg_isready no response); bootstrapping"

# --- step recreate-user ------------------------------------------------------------
if id -u "$RIG_USER" >/dev/null 2>&1; then
  actual_uid="$(id -u "$RIG_USER")"
  echo "step recreate-user: $RIG_USER already exists (uid $actual_uid)"
else
  echo "step recreate-user: $RIG_USER missing; creating with uid $RIG_UID"
  useradd -u "$RIG_UID" -m -s /bin/bash "$RIG_USER" 2>/dev/null \
    || fail "recreate-user" "useradd -u $RIG_UID $RIG_USER failed"
  actual_uid="$(id -u "$RIG_USER" 2>/dev/null)"
  [ -n "$actual_uid" ] || fail "recreate-user" "$RIG_USER still not resolvable after useradd"
fi
if [ "$actual_uid" != "$RIG_UID" ]; then
  fail "recreate-user" "$RIG_USER uid is $actual_uid, expected $RIG_UID (the data dir owner); refusing to start a cluster the user cannot read"
fi

# --- step ensure-traverse --------------------------------------------------------------
[ -d "$TRAVERSE_DIR" ] || fail "ensure-traverse" "traversal dir $TRAVERSE_DIR does not exist"
mode="$(stat -c %a "$TRAVERSE_DIR" 2>/dev/null)"
[ -n "$mode" ] || fail "ensure-traverse" "cannot stat $TRAVERSE_DIR"
last_digit="${mode: -1}"
case "$last_digit" in
  1|3|5|7) echo "step ensure-traverse: $TRAVERSE_DIR mode $mode already has o+x" ;;
  *)
    echo "step ensure-traverse: $TRAVERSE_DIR mode $mode lacks o+x; adding it (traverse-only)"
    chmod o+x "$TRAVERSE_DIR" 2>/dev/null \
      || fail "ensure-traverse" "chmod o+x $TRAVERSE_DIR failed"
    ;;
esac

# --- step check-data-dir + remove-stale-pid -----------------------------------------------
[ -f "$DATA_DIR/PG_VERSION" ] \
  || fail "check-data-dir" "missing piece: $DATA_DIR/PG_VERSION — the persistent cluster data dir is absent; this helper recovers it, it does not initdb a new one"
pid_file="$DATA_DIR/postmaster.pid"
if [ -f "$pid_file" ]; then
  stale_pid="$(head -n 1 "$pid_file" 2>/dev/null)"
  if pid_alive "$stale_pid"; then
    fail "remove-stale-pid" "recorded pid ${stale_pid:-unknown} in $pid_file is alive (kill -0 / ps check) — a postmaster may still own this data dir; refusing to remove the pid file or start another postmaster"
  fi
  echo "step remove-stale-pid: removing $pid_file (recorded pid ${stale_pid:-unknown} is not alive; pg_isready reported no response on $port)"
  rm -f "$pid_file" || fail "remove-stale-pid" "cannot remove $pid_file"
fi
mkdir -p "$SOCK_DIR" || fail "start-cluster" "cannot create socket dir $SOCK_DIR"
if [ "$(id -u)" = "0" ]; then
  chown "$RIG_USER:$RIG_USER" "$SOCK_DIR" 2>/dev/null \
    || echo "step start-cluster: note: chown $SOCK_DIR to $RIG_USER failed (continuing)"
fi

# --- step start-cluster ----------------------------------------------------------------------
echo "step start-cluster: starting $DATA_DIR on 127.0.0.1:$port (socket $SOCK_DIR) as $RIG_USER"
ctl_args=(-D "$DATA_DIR" -l "$LOG_FILE" -o "-p $port -k $SOCK_DIR -c listen_addresses=127.0.0.1" -w -t "$wait_sec" start)
if [ "$(id -u)" = "$(id -u "$RIG_USER")" ]; then
  "$PGBIN/pg_ctl" "${ctl_args[@]}" \
    || fail "start-cluster" "pg_ctl start failed (see $LOG_FILE)"
elif command -v runuser >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  runuser -u "$RIG_USER" -- env LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" "$PGBIN/pg_ctl" "${ctl_args[@]}" \
    || fail "start-cluster" "pg_ctl start via runuser -u $RIG_USER failed (see $LOG_FILE)"
elif command -v sudo >/dev/null 2>&1; then
  sudo -n -u "$RIG_USER" env LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" "$PGBIN/pg_ctl" "${ctl_args[@]}" \
    || fail "start-cluster" "pg_ctl start via sudo -u $RIG_USER failed (see $LOG_FILE)"
else
  fail "start-cluster" "current user is not $RIG_USER and neither runuser (as root) nor sudo is available to start the cluster as $RIG_USER"
fi

# --- step wait-ready ------------------------------------------------------------------------------
ready_out=""
i=1
while [ "$i" -le "$wait_sec" ]; do
  ready_out="$(pg_isready)" && break
  ready_out=""
  [ "$i" -lt "$wait_sec" ] && sleep 1
  i=$((i + 1))
done
[ -n "$ready_out" ] || fail "wait-ready" "cluster did not accept connections on 127.0.0.1:$port within ${wait_sec}s (see $LOG_FILE)"
echo "step wait-ready: pg_isready: $ready_out"

# --- step self-check ----------------------------------------------------------------------------------
[ -f "$REPO_DIR/migrate.js" ] \
  || fail "self-check-repo" "missing piece: $REPO_DIR/migrate.js — set PG_RIG_REPO_DIR to the repo checkout"
throwaway="pg_rig_selfcheck_$$"
case "$throwaway" in *[!a-z0-9_]*) fail "self-check-createdb" "internal: bad throwaway db name '$throwaway'" ;; esac
# M2: guarantee the throwaway drop even if the helper is killed
# between createdb and the explicit dropdb — EXIT trap (+ TERM/INT
# routed through exit so the EXIT trap runs).
throwaway_created=0
cleanup_throwaway() {
  if [ "$throwaway_created" -eq 1 ]; then
    "$PGBIN/dropdb" -h 127.0.0.1 -p "$port" -U postgres --if-exists "$throwaway" >/dev/null 2>&1 || true
  fi
}
trap cleanup_throwaway EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "step self-check-createdb: creating throwaway db $throwaway"
"$PGBIN/createdb" -h 127.0.0.1 -p "$port" -U postgres "$throwaway" 2>/dev/null \
  || fail "self-check-createdb" "createdb $throwaway failed"
throwaway_created=1

migrate_out="$(cd "$REPO_DIR" && DATABASE_URL="postgresql://postgres@127.0.0.1:${port}/${throwaway}" node migrate.js 2>&1)"
migrate_rc=$?
printf '%s\n' "$migrate_out" | tail -n 3 | sed 's/^/  migrate: /'
if [ "$migrate_rc" -ne 0 ]; then
  "$PGBIN/dropdb" -h 127.0.0.1 -p "$port" -U postgres --if-exists "$throwaway" 2>/dev/null
  fail "self-check-migrate" "node migrate.js exited $migrate_rc against throwaway db $throwaway (DATABASE_URL=postgresql://postgres@127.0.0.1:${port}/${throwaway}); throwaway drop attempted"
fi
echo "SELF-CHECK migrate exit=0 throwaway_db=$throwaway"

"$PGBIN/dropdb" -h 127.0.0.1 -p "$port" -U postgres "$throwaway" 2>/dev/null \
  || fail "self-check-dropdb" "dropdb $throwaway failed after a passing migrate"
throwaway_created=0
echo "step self-check-dropdb: dropped throwaway db $throwaway"

echo "READY port=$port host=127.0.0.1 rig_home=$RIG_HOME"
echo "BOOTSTRAPPED"
exit 0
