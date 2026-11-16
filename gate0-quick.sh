#!/usr/bin/env bash
# Re-run Gate 0 only (no re-seed, no re-authoring). Uses demo/repo and ~/tests-frozen from gate0.sh.
# Usage: RUNS=2 bash gate0-quick.sh
cd "$(dirname "$0")"
pkill -f "node server.js" 2>/dev/null
G=$(git -C demo/repo rev-list --max-parents=0 HEAD)
node bin/culprit.mjs gate0 --repo demo/repo --test tests/checkout_test.md --good "$G" --bad HEAD \
  --app "node server.js" --bundle ~/tests-frozen --runs "${RUNS:-2}" | tee gate0-result.txt
