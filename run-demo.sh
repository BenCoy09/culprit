#!/usr/bin/env bash
# Full real run with NO API key: clean-revert demo history, bisect on real Kane, revert fix, re-verify, linear baseline.
# Usage: bash run-demo.sh
cd "$(dirname "$0")"
pkill -f "node server.js" 2>/dev/null
rm -rf demo/repo && node demo/seed.mjs demo/repo --clean-revert || exit 1
G=$(git -C demo/repo rev-list --max-parents=0 HEAD)
node bin/culprit.mjs run --repo demo/repo --test tests/checkout_test.md --good "$G" --bad HEAD \
  --app "node server.js" --bundle ~/tests-frozen --fix revert --baseline 2>&1 | tee run-result.txt
