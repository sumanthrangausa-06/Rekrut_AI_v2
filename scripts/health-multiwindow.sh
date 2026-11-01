#!/usr/bin/env bash
# Multi-window health claim helper (HL-010, issue #2073).
#
# Usage: health-multiwindow.sh <health-url> [windows=3] [interval-sec=5]
#
# Samples the URL across N windows and prints every sample (HTTP code,
# gitCommit and db status parsed from the body when present). Prints
# HEALTHY only if ALL windows are HTTP 200 with db connected (when a
# db field exists in the body); otherwise prints NOT-HEALTHY.
# Exit: 0 = HEALTHY, 1 = NOT-HEALTHY, 2 = bad arguments.
set -u

usage() {
  echo "Usage: health-multiwindow.sh <health-url> [windows=3] [interval-sec=5]" >&2
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage; exit 0
fi

url="${1:-}"
windows="${2:-3}"
interval="${3:-5}"

if [ -z "$url" ]; then
  echo "error: missing health-url" >&2; usage; exit 2
fi
if [ "$#" -gt 3 ]; then
  echo "error: unexpected argument '$4'" >&2; usage; exit 2
fi
case "$windows" in
  ''|*[!0-9]*)
    echo "error: windows must be a positive integer, got '$windows'" >&2; usage; exit 2 ;;
esac
if [ "$windows" -lt 1 ]; then
  echo "error: windows must be a positive integer, got '$windows'" >&2; usage; exit 2
fi
case "$interval" in
  ''|*[!0-9]*)
    echo "error: interval-sec must be a positive integer, got '$interval'" >&2; usage; exit 2 ;;
esac
if [ "$interval" -lt 1 ]; then
  echo "error: interval-sec must be a positive integer, got '$interval'" >&2; usage; exit 2
fi

healthy=1
i=1
while [ "$i" -le "$windows" ]; do
  resp="$(curl -sS --max-time 15 -w $'\n%{http_code}' "$url" 2>/dev/null)"
  code="$(printf '%s\n' "$resp" | tail -n 1)"
  body="$(printf '%s\n' "$resp" | sed '$d')"
  case "$code" in
    ''|*[!0-9]*) code="000"; body="$resp" ;;
  esac

  # Parse gitCommit and db from the body when present. Handles both
  # "db":"connected" (string) and "db":{"connected":true} (object).
  flat="$(printf '%s' "$body" | tr -d ' \n\t\r')"
  commit="-"
  case "$flat" in
    *'"gitCommit":"'*'"'*)
      commit="$(printf '%s' "$flat" | sed -n 's/.*"gitCommit":"\([^"]*\)".*/\1/p' | head -n 1)" ;;
  esac
  db="absent"
  case "$flat" in
    *'"db":'*)
      case "$flat" in
        *'"db":"connected"'*|*'"db":{"connected":true'*|*'"db":{"status":"connected"'*)
          db="connected" ;;
        *'"db":"disconnected"'*|*'"db":{"connected":false'*|*'"db":{"status":"disconnected"'*)
          db="disconnected" ;;
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
