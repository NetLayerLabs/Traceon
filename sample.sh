#!/usr/bin/env bash
# Traceon sample mode: one command, from a clean clone, with no keys, accounts
# or network. Installs dependencies if needed, runs the real engine end to end
# and writes every output to sample-output/.
#   ./sample.sh           run the sample and print a summary
#   ./sample.sh --serve   then start the full app offline on http://localhost:3000 (PORT=… to change)
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18.18 or newer is required: https://nodejs.org" >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 18 ]; then
  echo "Node.js 18.18 or newer is required (found $(node -v))." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm ci --no-audit --no-fund
fi

npx tsx scripts/sample.mts

if [ "${1:-}" = "--serve" ]; then
  # The app with every live integration switched off: labelled templates, local SQL engine.
  export NVIDIA_API_KEY= NIGHTSHIFT_TOKEN= NIGHTSHIFT_TOKEN_FILE= ZETARIS_API_URL= ZETARIS_API_TOKEN= ZETARIS_USERNAME= BRIGHTDATA_API_TOKEN=
  export METERLESS_STORAGE_DIR="${TMPDIR:-/tmp}/traceon-sample-app" NEXT_DIST_DIR=.next-sample NEXT_TELEMETRY_DISABLED=1
  echo "Building the app (about a minute)..."
  npx next build >/dev/null
  port="${PORT:-3000}"
  echo "Traceon (offline sample mode) on http://localhost:$port  -  Ctrl+C to stop"
  npx next start -p "$port"
fi
