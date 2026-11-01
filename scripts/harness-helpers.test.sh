#!/usr/bin/env bash
# Stubbed tests for the HL-010 helpers (issue #2073):
#   scripts/health-multiwindow.sh and scripts/lane-pick-precheck.sh
#
# No network: `curl` and `gh` are stubbed via PATH. The lane-pick
# ancestor check runs against a real fixture git repo (a local
# refs/remotes/origin/dev ref), so `git` is NOT stubbed.
#
# Health cases:
#   a. all windows 200 + db connected       -> HEALTHY, exit 0
#   b. mixed 200/404                        -> NOT-HEALTHY, exit 1
#   c. 200 but db disconnected              -> NOT-HEALTHY, exit 1
#   d. bad windows arg                      -> exit 2, names the bad value
#   e. missing URL arg                      -> exit 2
#   i. overflow windows arg (>9 digits)     -> exit 2, names the bad value
#   j. overflow interval arg (>9 digits)    -> exit 2, names the bad value
#   l. object db {"connected":true}        -> HEALTHY, exit 0
#   m. object db {"connected":false}       -> NOT-HEALTHY, exit 1
# Lane-pick cases:
#   f. missing arg                          -> exit 2
#   g. non-numeric arg                      -> exit 2, names the bad value
#   h. fixture issue + one merged PR whose merge commit is an
#      ancestor of origin/dev               -> exit 0, output shows
#      state/title, a comment author, the PR, and ancestor=yes
#   k. overflow issue number (>9 digits)    -> exit 2, names the bad value
#   n. every gh call carries -R <repo>      -> exit 0, stub log shows
#      the -R fixture-owner/fixture-repo flag on every call (M1)
#   o. merged PR whose merge commit is NOT an ancestor of
#      origin/dev                           -> exit 0, ancestor=no (M3)
#
# Prints PASS/FAIL per case; exits non-zero if any case fails.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
HEALTH="$HERE/health-multiwindow.sh"
LANE="$HERE/lane-pick-precheck.sh"
WORK="$(mktemp -d)"
FAILURES=0
trap 'rm -rf "$WORK"' EXIT

report() { # $1=0 pass / 1 fail, $2=label
  if [ "$1" -eq 0 ]; then echo "PASS: $2"; else echo "FAIL: $2"; FAILURES=$((FAILURES + 1)); fi
}

# --- stubs -----------------------------------------------------------------
STUBBIN="$WORK/bin"
mkdir -p "$STUBBIN"

# curl stub: serves line N of $STUB_RESPONSES on call N (file is
# "<code><TAB><body>" per line). Honours a -w format containing
# %{http_code} by appending "<newline><code>" like real curl -w '\n%{http_code}'.
cat > "$STUBBIN/curl" <<'SH'
#!/usr/bin/env bash
fmt=""
for a in "$@"; do case "$a" in *'%{http_code}'*) fmt=1 ;; esac; done
n=0; [ -f "$STUB_COUNT" ] && n="$(cat "$STUB_COUNT")"
n=$((n + 1)); printf '%s' "$n" > "$STUB_COUNT"
line="$(sed -n "${n}p" "$STUB_RESPONSES")"
[ -z "$line" ] && line="$(tail -n 1 "$STUB_RESPONSES")"
code="${line%%	*}"; body="${line#*	}"
printf '%s' "$body"
[ -n "$fmt" ] && printf '\n%s' "$code"
exit 0
SH

# gh stub: fixture issue / comments / search / PR merge commit.
# Distinguishes calls by the field names in the arguments.
# M1: every call MUST carry the repo-scoping flag
# "-R fixture-owner/fixture-repo" (the fixture repos' origin slug);
# an unscoped call fails here, so dropping REPO_ARGS in the lane
# script turns cases h/n/o red. Calls are also appended to
# $STUB_GH_LOG when set, for case n's explicit assertion.
cat > "$STUBBIN/gh" <<'SH'
#!/usr/bin/env bash
args="$*"
[ -n "${STUB_GH_LOG:-}" ] && printf '%s\n' "$args" >> "$STUB_GH_LOG"
case " $args " in
  *" -R fixture-owner/fixture-repo "*) ;;
  *) echo "gh stub: missing -R repo scoping: $args" >&2; exit 1 ;;
esac
case "$args" in
  "issue view"*"comments"*)
    printf -- '---@fixture-alice\nfixture comment line one\nfixture comment line two\n' ;;
  "issue view"*"state"*)
    printf 'OPEN\tFixture Issue Title\n' ;;
  "search prs"*)
    printf '999\tFixture merged PR\thttps://example.invalid/pull/999\n' ;;
  "pr view"*)
    printf '%s\n' "${FIXTURE_MERGE_OID:-}" ;;
  *) echo "gh stub: unexpected args: $args" >&2; exit 1 ;;
esac
SH
chmod +x "$STUBBIN/curl" "$STUBBIN/gh"

run_health() { # $1=responses-file $2..=helper args; sets RC, OUT
  local resp="$1"; shift
  printf '0' > "$WORK/count"
  OUT="$(STUB_COUNT="$WORK/count" STUB_RESPONSES="$resp" PATH="$STUBBIN:$PATH" \
    bash "$HEALTH" "$@" 2>&1)"
  RC=$?
}

# --- a. all 200 + db connected -> HEALTHY, exit 0 ---------------------------
printf '200\t{"status":"ok","gitCommit":"abc1234","db":"connected"}\n200\t{"status":"ok","gitCommit":"abc1234","db":"connected"}\n200\t{"status":"ok","gitCommit":"abc1234","db":"connected"}\n' > "$WORK/resp-a"
run_health "$WORK/resp-a" https://example.invalid/health 3 1
ok=0; { [ "$RC" -eq 0 ] && printf '%s\n' "$OUT" | grep -qx 'HEALTHY'; } || ok=1
report "$ok" "a all-200+db-connected -> HEALTHY exit 0 (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- b. mixed 200/404 -> NOT-HEALTHY, exit 1 --------------------------------
printf '200\t{"status":"ok","gitCommit":"abc1234","db":"connected"}\n404\t{}\n200\t{"status":"ok","gitCommit":"abc1234","db":"connected"}\n' > "$WORK/resp-b"
run_health "$WORK/resp-b" https://example.invalid/health 3 1
ok=0; { [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qx 'NOT-HEALTHY'; } || ok=1
report "$ok" "b mixed 200/404 -> NOT-HEALTHY exit 1 (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- c. 200 but db disconnected -> NOT-HEALTHY, exit 1 -----------------------
printf '200\t{"status":"degraded","gitCommit":"abc1234","db":"disconnected"}\n200\t{"status":"degraded","gitCommit":"abc1234","db":"disconnected"}\n' > "$WORK/resp-c"
run_health "$WORK/resp-c" https://example.invalid/health 2 1
ok=0; { [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qx 'NOT-HEALTHY'; } || ok=1
report "$ok" "c 200+db-disconnected -> NOT-HEALTHY exit 1 (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- d. bad windows arg -> exit 2 naming the value ---------------------------
run_health "$WORK/resp-a" https://example.invalid/health abc 0
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'abc'"; } || ok=1
report "$ok" "d windows=abc -> exit 2 naming bad value (rc=$RC out=$(printf '%s' "$OUT" | head -1))"

# --- e. missing URL -> exit 2 -------------------------------------------------
OUT="$(bash "$HEALTH" 2>&1)"; RC=$?
ok=0; [ "$RC" -eq 2 ] || ok=1
report "$ok" "e missing URL -> exit 2 (rc=$RC)"

# --- f. lane: missing arg -> exit 2 -------------------------------------------
OUT="$(bash "$LANE" 2>&1)"; RC=$?
ok=0; [ "$RC" -eq 2 ] || ok=1
report "$ok" "f lane missing arg -> exit 2 (rc=$RC)"

# --- g. lane: non-numeric arg -> exit 2 naming the value ----------------------
OUT="$(bash "$LANE" xyz 2>&1)"; RC=$?
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'xyz'"; } || ok=1
report "$ok" "g lane arg=xyz -> exit 2 naming bad value (rc=$RC out=$(printf '%s' "$OUT" | head -1))"

# --- h. lane: fixture issue + merged PR, ancestor=yes --------------------------
# Fixture repos carry a github origin so the lane script derives the
# slug fixture-owner/fixture-repo and scopes its gh calls with -R.
make_fixture_repo() { # $1=dir; echoes HEAD oid
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" config user.email stub@example.invalid
  git -C "$1" config user.name stub
  git -C "$1" remote add origin https://github.com/fixture-owner/fixture-repo.git
  printf 'x\n' > "$1/f.txt"
  git -C "$1" add f.txt
  git -C "$1" commit -qm fixture
  git -C "$1" rev-parse HEAD
}
FIXREPO="$WORK/fixrepo"
MERGE_OID="$(make_fixture_repo "$FIXREPO")"
git -C "$FIXREPO" update-ref refs/remotes/origin/dev "$MERGE_OID"
OUT="$(cd "$FIXREPO" && FIXTURE_MERGE_OID="$MERGE_OID" PATH="$STUBBIN:$PATH" bash "$LANE" 2073 2>&1)"; RC=$?
ok=0
{ [ "$RC" -eq 0 ] \
  && printf '%s' "$OUT" | grep -qF 'Fixture Issue Title' \
  && printf '%s' "$OUT" | grep -qF 'fixture-alice' \
  && printf '%s' "$OUT" | grep -qF '999' \
  && printf '%s' "$OUT" | grep -qF 'ancestor of origin/dev: yes'; } || ok=1
report "$ok" "h lane fixture -> exit 0, title+comment+PR+ancestor=yes (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  lane-out: /'; fi

# --- i. health: overflow windows -> exit 2 naming the value -------------------
run_health "$WORK/resp-a" https://example.invalid/health 99999999999999999999999999 1
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'99999999999999999999999999'"; } || ok=1
report "$ok" "i windows=overflow -> exit 2 naming bad value (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- j. health: overflow interval -> exit 2 naming the value ------------------
run_health "$WORK/resp-a" https://example.invalid/health 2 99999999999999999999999999
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'99999999999999999999999999'"; } || ok=1
report "$ok" "j interval=overflow -> exit 2 naming bad value (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- k. lane: overflow issue number -> exit 2 naming the value ----------------
OUT="$(bash "$LANE" 99999999999999999999999999 2>&1)"; RC=$?
ok=0; { [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -qF "'99999999999999999999999999'"; } || ok=1
report "$ok" "k lane arg=overflow -> exit 2 naming bad value (rc=$RC out=$(printf '%s' "$OUT" | head -1))"

# --- l. health: object db connected:true -> HEALTHY, exit 0 -------------------
printf '200\t{"status":"ok","gitCommit":"abc1234","db":{"connected":true}}\n200\t{"status":"ok","gitCommit":"abc1234","db":{"connected":true}}\n' > "$WORK/resp-l"
run_health "$WORK/resp-l" https://example.invalid/health 2 1
ok=0; { [ "$RC" -eq 0 ] && printf '%s\n' "$OUT" | grep -qx 'HEALTHY'; } || ok=1
report "$ok" "l object db connected:true -> HEALTHY exit 0 (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- m. health: object db connected:false -> NOT-HEALTHY, exit 1 --------------
printf '200\t{"status":"degraded","gitCommit":"abc1234","db":{"connected":false}}\n200\t{"status":"degraded","gitCommit":"abc1234","db":{"connected":false}}\n' > "$WORK/resp-m"
run_health "$WORK/resp-m" https://example.invalid/health 2 1
ok=0; { [ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qx 'NOT-HEALTHY'; } || ok=1
report "$ok" "m object db connected:false -> NOT-HEALTHY exit 1 (rc=$RC out=$(printf '%s' "$OUT" | tail -1))"

# --- n. lane: every gh call carries -R fixture-owner/fixture-repo (M1) --------
GHLOG="$WORK/gh-calls.log"; : > "$GHLOG"
OUT="$(cd "$FIXREPO" && FIXTURE_MERGE_OID="$MERGE_OID" STUB_GH_LOG="$GHLOG" PATH="$STUBBIN:$PATH" bash "$LANE" 2073 2>&1)"; RC=$?
unscoped="$(grep -cvF -- '-R fixture-owner/fixture-repo' "$GHLOG")"
ok=0; { [ "$RC" -eq 0 ] && [ -s "$GHLOG" ] && [ "$unscoped" -eq 0 ]; } || ok=1
report "$ok" "n lane gh calls all carry -R repo flag (rc=$RC calls=$(wc -l < "$GHLOG") unscoped=$unscoped)"

# --- o. lane: merged PR NOT ancestor of origin/dev -> ancestor=no (M3) --------
FIXREPO2="$WORK/fixrepo2"
DEV_OID="$(make_fixture_repo "$FIXREPO2")"
git -C "$FIXREPO2" update-ref refs/remotes/origin/dev "$DEV_OID"
printf 'y\n' >> "$FIXREPO2/f.txt"
git -C "$FIXREPO2" add f.txt
git -C "$FIXREPO2" commit -qm second
NOTANCESTOR_OID="$(git -C "$FIXREPO2" rev-parse HEAD)"
OUT="$(cd "$FIXREPO2" && FIXTURE_MERGE_OID="$NOTANCESTOR_OID" PATH="$STUBBIN:$PATH" bash "$LANE" 2073 2>&1)"; RC=$?
ok=0
{ [ "$RC" -eq 0 ] \
  && printf '%s' "$OUT" | grep -qF 'ancestor of origin/dev: no'; } || ok=1
report "$ok" "o lane fixture -> exit 0, ancestor=no (rc=$RC)"
if [ "$ok" -ne 0 ]; then printf '%s\n' "$OUT" | sed 's/^/  lane-out: /'; fi

if [ "$FAILURES" -eq 0 ]; then echo "ALL PASS"; else echo "$FAILURES case(s) FAILED"; fi
exit "$FAILURES"
