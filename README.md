# Culprit

When a committed browser test starts failing, Culprit finds the commit that broke it, hands that commit's diff
and the failing step's evidence to a coding agent, and re-verifies the fix with the same frozen Kane recordings.

It bisects with **Kane CLI `testmd` replays** (zero LLM cost once recorded), not with a model guessing at the diff.

## How a run works
1. Freeze the test bundle (`tests/*_test.md` and its `output-*/` recordings) from the known-good commit.
2. Check the good and bad endpoints (`--stability N` times each). Abort if they disagree with expectations.
3. Binary-search the commits in between. Each probe: fresh git worktree, start the app, replay the frozen test
   with `kane-cli testmd run --agent --headless --no-adaptive-heal`.
4. Confirm the boundary pair twice. Disagreement means "inconclusive", never a guess.
5. Fix with `--fix revert` (git revert) or `--fix agent` (model patch from the culprit diff). The fix commit may
   not touch the test bundle, and re-verification uses the frozen recordings.
6. Write `culprit-report/index.html` and `result.json`.

Design decisions that matter:
- `--no-adaptive-heal`: healing can re-author a broken step and turn a real regression into a pass.
- Exit 2 or 3 from Kane (error, timeout) is a **skip**, never "bad". Bisect aborts rather than framing a commit.
- The recordings are frozen from the good commit, so probes test the app, not the test.

## Run it on real Kane (Gate 0)
```
npm i -g @testmuai/kane-cli && kane-cli login --username <u> --access-key <k>
bash gate0.sh        # re-seeds the demo repo, authors the test once, freezes it, runs Gate 0 (10 replays per side)
```
Gate 0 must report 10/10 on both sides. If replay is flaky, a bisect result is not trustworthy.
Then the full loop:
```
G=$(git -C demo/repo rev-list --max-parents=0 HEAD)
export ANTHROPIC_API_KEY=...   # only for --fix agent
node bin/culprit.mjs run --repo demo/repo --test tests/checkout_test.md --good $G --bad HEAD \
  --app "node server.js" --bundle ~/tests-frozen --fix agent --baseline
```
In your own repo you can instead commit `output-*/` at the good commit and omit `--bundle`.

## Offline tests (no Kane needed)
`npm test` runs 8 tests against `demo/fake-kane.mjs`, a **stand-in** that executes the page script in a DOM stub.
It validates the bisect, abort, skip, fix and guard logic. It says nothing about how real Kane behaves.
The agent-fix test stubs the model API; `--fix agent` has not been run against a real model yet.

## Known limits
- First-parent history only; the regression must be monotonic (good ... good bad ... bad).
- One test file, one app command per run. The app must start from a clean checkout (`--setup "npm ci"` if needed).
- Unverified against real Kane: exact `testmd` event shapes beyond `test_md_done` (exit codes are the source of truth),
  and whether `--on-lock-conflict readonly` is needed to avoid probe uploads (pass via code `kaneExtra` if so).
