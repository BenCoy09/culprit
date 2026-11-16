#!/usr/bin/env bash
# One-go setup: re-seed demo repo, author the test once on real Kane, freeze it, run Gate 0.
# Usage: bash gate0.sh        (run from the culprit folder; Kane must be logged in)
set -u
cd "$(dirname "$0")"
RUNS="${RUNS:-10}"

echo "== 1/4 re-seed demo repo"
npm run seed || exit 1
G=$(git -C demo/repo rev-list --max-parents=0 HEAD)

echo "== 2/4 author the test once at the good commit"
pkill -f "node server.js" 2>/dev/null
rm -rf ~/authoring && mkdir -p ~/authoring
git -C demo/repo archive "$G" | tar -x -C ~/authoring
( cd ~/authoring && (node server.js >/dev/null 2>&1 &) ; sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)
  echo "server http: $code"
  [ "$code" = "200" ] || { echo "STOP: server not up"; exit 1; }
  kane-cli testmd run tests/checkout_test.md --url http://localhost:3000 --agent --headless
  echo "authoring exit code: $?"
)
pkill -f "node server.js" 2>/dev/null
grep -q "status: passed" ~/authoring/tests/output-checkout/Result.md || { echo "STOP: authoring did not pass"; cat ~/authoring/tests/output-checkout/Result.md; exit 1; }
rm -rf ~/tests-frozen && cp -r ~/authoring/tests ~/tests-frozen

echo "== 3/4 Gate 0 ($RUNS runs each side, 2x$RUNS replays; this takes a while)"
node bin/culprit.mjs gate0 --repo demo/repo --test tests/checkout_test.md --good "$G" --bad HEAD \
  --app "node server.js" --bundle ~/tests-frozen --runs "$RUNS" | tee gate0-result.txt

echo "== 4/4 done. Send me a photo of the result above."
