#!/usr/bin/env bash
# Sequential E2E Test Runner — Shell wrapper
# Usage: ./run-e2e-sequential.sh [--mobile] [extra playwright args]
#
# This runs each spec file one at a time to avoid SIGKILL from
# browser process accumulation. See scripts/run-e2e-sequential.js
# for implementation details.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

exec node "${SCRIPT_DIR}/run-e2e-sequential.js" "$@"
