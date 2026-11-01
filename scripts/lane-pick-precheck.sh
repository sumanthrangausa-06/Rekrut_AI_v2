#!/usr/bin/env bash
# Lane-pick pre-check helper (HL-010, issue #2073).
#
# Usage: lane-pick-precheck.sh <issue-number>
#
# Prints, before any STOP 1 is written for an issue:
#   - the issue's state and title
#   - its latest 10 comments (author + first ~5 lines of each body)
#   - merged PRs referencing the issue (gh search)
#   - for each merged PR, whether its merge commit is an ancestor of
#     origin/dev (checked against the LOCAL origin/dev ref — run
#     `git fetch origin dev` first for a fresh answer)
# Purpose: OPEN != unbuilt — no dispatch from a stale premise.
# Exit: 0 = pre-check printed, 2 = bad arguments,
#       3 = degraded run (gh unavailable; output text says so) — #2075 M4.
set -u

usage() {
  echo "Usage: lane-pick-precheck.sh <issue-number>" >&2
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage; exit 0
fi

issue="${1:-}"
if [ -z "$issue" ]; then
  echo "error: missing issue-number" >&2; usage; exit 2
fi
if [ "$#" -gt 1 ]; then
  echo "error: unexpected argument '$2'" >&2; usage; exit 2
fi
case "$issue" in
  ''|*[!0-9]*)
    echo "error: issue-number must be a positive integer, got '$issue'" >&2; usage; exit 2 ;;
esac
# Bound digit length before any integer test: a >int64 value makes
# `[ -lt ]` error out (treated as false) and validation falls
# through (review B1 on PR #2074).
if [ "${#issue}" -gt 9 ]; then
  echo "error: issue-number must be a positive integer, got '$issue'" >&2; usage; exit 2
fi
if [ "$issue" -lt 1 ]; then
  echo "error: issue-number must be a positive integer, got '$issue'" >&2; usage; exit 2
fi

# Scope every gh call to this repo: unscoped `gh search prs "<n>"`
# matches PR *number* <n> across all of GitHub. The slug comes from
# the origin remote; without one, gh falls back to its own context.
REPO_ARGS=()
origin_url="$(git remote get-url origin 2>/dev/null)"
slug="$(printf '%s' "$origin_url" | sed -n 's|.*github\.com[:/]\([^/]*\)/\([^/]*\)$|\1/\2|p' | sed 's/\.git$//')"
case "$slug" in */*) REPO_ARGS=(-R "$slug") ;; esac

degraded=0
echo "== Issue #$issue =="
meta="$(gh issue view "$issue" "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" --json state,title --jq '"\(.state)\t\(.title)"' 2>/dev/null)"
if [ -n "$meta" ]; then
  state="${meta%%	*}"; title="${meta#*	}"
  echo "state: $state"
  echo "title: $title"
else
  echo "state: (unavailable — gh issue view failed)"
  degraded=1
fi

echo
echo "== Latest comments (up to 10, first 5 lines each) =="
comments="$(gh issue view "$issue" "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" --json comments --jq '.comments[-10:][] | "---@\(.author.login)\n\(.body | split("\n")[:5] | join("\n"))"' 2>/dev/null)"
if [ -n "$comments" ]; then
  printf '%s\n' "$comments"
else
  echo "(no comments or gh unavailable)"
fi

echo
echo "== Merged PRs referencing #$issue =="
prs="$(gh search prs "$issue" --merged "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" --json number,title,url --jq '.[] | "\(.number)\t\(.title)\t\(.url)"' 2>/dev/null)"
if [ -z "$prs" ]; then
  echo "(none found)"
else
  printf '%s\n' "$prs" | while IFS="$(printf '\t')" read -r pr_num pr_title pr_url; do
    [ -n "$pr_num" ] || continue
    oid="$(gh pr view "$pr_num" "${REPO_ARGS[@]+"${REPO_ARGS[@]}"}" --json mergeCommit --jq '.mergeCommit.oid' 2>/dev/null)"
    ancestor="unknown"
    if [ -n "$oid" ]; then
      git merge-base --is-ancestor "$oid" origin/dev 2>/dev/null
      arc=$?
      if [ "$arc" -eq 0 ]; then
        ancestor="yes"
      elif [ "$arc" -eq 1 ]; then
        ancestor="no"
      fi
    fi
    echo "PR #$pr_num: $pr_title ($pr_url)"
    echo "  mergeCommit: ${oid:-(unavailable)}"
    echo "  ancestor of origin/dev: $ancestor"
  done
fi
if [ "$degraded" -eq 1 ]; then exit 3; fi
exit 0
