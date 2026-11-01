#!/usr/bin/env bash
# Multi-window health claim helper (HL-010, issue #2073).
#
# Usage: health-multiwindow.sh <health-url> [windows=3] [interval-sec=5] [timeout-sec=30]
#
# Samples the URL across N windows and prints every sample (HTTP code,
# gitCommit and db status parsed from the body when present). Prints
# HEALTHY only if ALL windows are HTTP 200 with db connected (when a
# db field exists in the body); otherwise prints NOT-HEALTHY.
# timeout-sec is the per-window curl timeout: default 30s, above the
# ~22s cold wake observed on a sleeping free-tier service (#2079) —
# the old fixed 15s sampled a sleeping-but-healthy service as 000 in
# every window. Pass a short value for fast local checks.
# Exit: 0 = HEALTHY, 1 = NOT-HEALTHY, 2 = bad arguments.
set -u

usage() {
  echo "Usage: health-multiwindow.sh <health-url> [windows=3] [interval-sec=5] [timeout-sec=30]" >&2
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage; exit 0
fi

url="${1:-}"
windows="${2:-3}"
interval="${3:-5}"
timeout="${4:-30}"

if [ -z "$url" ]; then
  echo "error: missing health-url" >&2; usage; exit 2
fi
if [ "$#" -gt 4 ]; then
  echo "error: unexpected argument '$5'" >&2; usage; exit 2
fi
case "$windows" in
  ''|*[!0-9]*)
    echo "error: windows must be a positive integer, got '$windows'" >&2; usage; exit 2 ;;
esac
# Bound digit length before any integer test: a >int64 value makes
# `[ -lt ]` error out (treated as false) and the loop would sample
# zero windows yet still print HEALTHY (review B1 on PR #2074).
if [ "${#windows}" -gt 9 ]; then
  echo "error: windows must be a positive integer, got '$windows'" >&2; usage; exit 2
fi
if [ "$windows" -lt 1 ]; then
  echo "error: windows must be a positive integer, got '$windows'" >&2; usage; exit 2
fi
case "$interval" in
  ''|*[!0-9]*)
    echo "error: interval-sec must be a positive integer, got '$interval'" >&2; usage; exit 2 ;;
esac
if [ "${#interval}" -gt 9 ]; then
  echo "error: interval-sec must be a positive integer, got '$interval'" >&2; usage; exit 2
fi
if [ "$interval" -lt 1 ]; then
  echo "error: interval-sec must be a positive integer, got '$interval'" >&2; usage; exit 2
fi
case "$timeout" in
  ''|*[!0-9]*)
    echo "error: timeout-sec must be a positive integer, got '$timeout'" >&2; usage; exit 2 ;;
esac
if [ "${#timeout}" -gt 9 ]; then
  echo "error: timeout-sec must be a positive integer, got '$timeout'" >&2; usage; exit 2
fi
if [ "$timeout" -lt 1 ] || [ "$timeout" -gt 300 ]; then
  echo "error: timeout-sec must be between 1 and 300, got '$timeout'" >&2; usage; exit 2
fi

healthy=1
i=1
while [ "$i" -le "$windows" ]; do
  resp="$(curl -sS --max-time "$timeout" -w $'\n%{http_code}' "$url" 2>/dev/null)"
  code="$(printf '%s\n' "$resp" | tail -n 1)"
  body="$(printf '%s\n' "$resp" | sed '$d')"
  case "$code" in
    ''|*[!0-9]*) code="000"; body="$resp" ;;
  esac

  # Parse gitCommit and db from the body when present. Handles both
  # "db":"connected" (string) and "db":{"connected":true} (object).
  # M7 (#2075): the app's /health names the SHA field "commit" —
  # parse it as a fallback when "gitCommit" is absent.
  flat="$(printf '%s' "$body" | tr -d ' \n\t\r')"
  commit="-"
  case "$flat" in
    *'"gitCommit":"'*'"'*)
      commit="$(printf '%s' "$flat" | sed -n 's/.*"gitCommit":"\([^"]*\)".*/\1/p' | head -n 1)" ;;
    *'"commit":"'*'"'*)
      commit="$(printf '%s' "$flat" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' | head -n 1)" ;;
  esac
  # M6 (#2075): classify db from its own value only — the text right
  # after the first "db": — checking disconnected forms first, so a
  # connected substring elsewhere in the body cannot mask it (the old
  # whole-body connected-first match did exactly that).
  db="absent"
  case "$flat" in
    *'"db":'*)
      db_tail="${flat#*\"db\":}"
      case "$db_tail" in
        '"disconnected"'*|'{"connected":false'*|'{"status":"disconnected"'*)
          db="disconnected" ;;
        '"connected"'*|'{"connected":true'*|'{"status":"connected"'*)
          db="connected" ;;
        *) db="unknown" ;;
      esac ;;
  esac

  echo "window $i: HTTP $code gitCommit=$commit db=$db"

  if [ "$code" != "200" ]; then healthy=0; fi
  if [ "$db" != "absent" ] && [ "$db" != "connected" ]; then healthy=0; fi

  if [ "$i" -lt "$windows" ] && [ "$interval" -gt 0 ]; then sleep "$interval"; fi
  i=$((i + 1))
done

if [ "$healthy" -eq 1 ]; then
  echo "HEALTHY"
  exit 0
else
  echo "NOT-HEALTHY"
  exit 1
fi
