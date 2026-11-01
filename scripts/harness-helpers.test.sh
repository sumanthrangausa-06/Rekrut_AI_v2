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
# Lane-pick cases:
#   f. missing arg                          -> exit 2
#   g. non-numeric arg                      -> exit 2, names the bad value
#   h. fixture issue + one merged PR whose merge commit is an
#      ancestor of origin/dev               -> exit 0, output shows
#      state/title, a comment author, the PR, and ancestor=yes
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
cat > "$STUBBIN/gh" <<'SH'
#!/usr/bin/env bash
args="$*"
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
FIXREPO="$WORK/fixrepo"
mkdir -p "$FIXREPO"
git -C "$FIXREPO" init -q
git -C "$FIXREPO" config user.email stub@example.invalid
git -C "$FIXREPO" config user.name stub
printf 'x\n' > "$FIXREPO/f.txt"
git -C "$FIXREPO" add f.txt
git -C "$FIXREPO" commit -qm fixture
MERGE_OID="$(git -C "$FIXREPO" rev-parse HEAD)"
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

if [ "$FAILURES" -eq 0 ]; then echo "ALL PASS"; else echo "$FAILURES case(s) FAILED"; fi
exit "$FAILURES"
