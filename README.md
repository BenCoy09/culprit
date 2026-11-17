<div align="center">

# 🔎 Culprit

**An agent made 20 commits today. One silently broke checkout. Which one?**
Culprit finds it by replaying a recorded [Kane CLI](https://www.npmjs.com/package/@testmuai/kane-cli) test across your git history. Then it closes the loop: **Kane's failure evidence goes to an agent, the agent patches, Kane replays the same test on the patch, and if Kane still says no, Kane's new evidence goes back to the agent.** Nothing is kept that Kane did not confirm.

```bash
npx github:BenCoy09/culprit run --repo . --test tests/checkout_test.md --good <sha> --bad HEAD \
  --app "node server.js" --fix
```

</div>

**[Live site](https://bencoy09.github.io/culprit/)** · [Replay the real run](https://bencoy09.github.io/culprit/live.html) · [Run report](https://bencoy09.github.io/culprit/report/)

---

## Proof (real Kane, real runs)

| What | Result |
|---|---|
| Test authored once on Kane (`testmd`), 2 steps | **passed**, adaptive heal not triggered |
| **Gate 0**: replay the frozen test 10× at the good commit and 10× at the bad commit | **good 10/10 pass, bad 10/10 fail, 0 errors** |
| Replay cost and speed | ~12 s per replay, no re-authoring |
| Kane CLI smoke test (`kane-cli run`, 0.10.4) | `run_end` **passed**, 11.99 credits, evidence pack saved |

<p align="center">
  <img src="docs/img/kane-proof.png" width="96%" alt="kane-cli run: run_end status passed, session and evidence pack">
</p>
<p align="center">
  <img src="docs/img/gate0.jpg" width="48%" alt="Gate 0: 10/10 good, 10/10 bad">
  <img src="docs/img/authoring.jpg" width="48%" alt="Kane testmd authoring run passed">
</p>
<p align="center">
  <img src="docs/img/bisect-run.jpg" width="48%" alt="Culprit run: culprit found in 4 probes vs 7 for linear scan">
  <img src="docs/img/report.png" width="48%" alt="Culprit report page">
</p>

Raw output is committed: [`gate0-result.txt`](gate0-result.txt), [`run-result.txt`](run-result.txt).

## How it works

```mermaid
flowchart LR
  A[Known-good commit<br/>test authored on Kane] --> B[Freeze test + recordings]
  B --> C{Bisect history}
  C -->|each probe| D[Fresh worktree · start app<br/>kane-cli testmd run<br/>--no-adaptive-heal]
  D -->|exit 0 good · 1 bad · 2/3 skip| C
  C --> E[Culprit commit]
  E --> F[Revert, or agent patch]
  F --> G[Kane replays the SAME frozen recordings]
  G -->|passes| H[Report + .evidence packs]
  G -->|fails: new Kane evidence| I[Back to the agent, up to 3 tries]
  I --> F
```

Replays reuse recordings, so a probe costs seconds and no model calls. That is what makes bisecting a browser flow practical.

## The closed loop (`--fix`)

| Step | What happens |
|---|---|
| 1 | `git revert` of the culprit, if it applies. Kane replays the frozen test on it. Passes, done. |
| 2 | A revert that conflicts with later commits (the normal case after an agent's busy day) goes to the agent: culprit diff + Kane's failing step + Kane's `Result.md` + the current files. |
| 3 | The agent's patch is committed and Kane replays the same frozen recordings on it. |
| 4 | Kane says bad? The patch is rolled back and the agent gets what it tried plus what Kane said. Up to `--attempts` (default 3). |
| 5 | A patch that touches the test bundle is rejected, so the agent cannot "fix" a bug by weakening the test. |

Every try, its Kane verdict, the Kane run link (`test_url`, when Kane prints one) and the sealed `.evidence` pack (`--evidence <dir>`) land in the report.

## Why you can trust the answer

- **Healing is off.** Kane's adaptive healing could re-author a broken step and turn a real regression into a pass, so every probe runs with `--no-adaptive-heal`.
- **Errors are never blame.** Kane exit 2/3 (error, timeout) is a *skip*, never "bad". Culprit aborts rather than accuse a commit.
- **The test is frozen** from the good commit. Probes test the app, not the test.
- **Test-integrity guard.** A fix commit that touches the test bundle is rejected, so nothing can "fix" a bug by weakening the test.
- **Gate 0 first.** If replays are flaky, `culprit gate0` says so before you trust any bisect.
- **Boundary confirmed twice.** Disagreement is reported as "inconclusive", never guessed.

## Run it

```bash
npm i -g @testmuai/kane-cli && kane-cli login --username <u> --access-key <k>

bash gate0.sh        # seed demo repo, author the test once on real Kane, freeze it, run Gate 0
bash run-demo.sh     # bisect + revert fix + re-verify + linear-scan baseline (no model key needed)
```

Your own repo:

```bash
npx github:BenCoy09/culprit run --repo . --test tests/checkout_test.md --good <sha> --bad HEAD \
  --app "node server.js" --fix --baseline --evidence culprit-report/evidence
```

Commit the test's `output-*/` recordings at the good commit, or pass `--bundle <dir>`. `--fix` is opt-in because it commits to your repo: bare `--fix` is `auto` (revert if Kane confirms it, otherwise the agent loop); `--fix revert`, `--fix agent` and `--attempts N` are also available.

### The agent: any model, including free tiers

The agent loop needs one model endpoint. Any OpenAI-compatible endpoint works, including free tiers:

```bash
export FIX_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
export FIX_API_KEY=<free key from Google AI Studio>
export MODEL=<a model name from your provider>
npx github:BenCoy09/culprit run ... --fix
```

Groq, OpenRouter and a local Ollama (`http://localhost:11434/v1/chat/completions`) use the same three variables. With `ANTHROPIC_API_KEY` set and no `FIX_API_URL`, the Anthropic API is used. Free tiers may use prompts to improve the provider's products, so use them on non-sensitive code.

## Honest limits

- The agent loop (try, Kane verdict, feedback, rollback, give-up) is covered by tests that use a **scripted stand-in agent**, so they prove the loop, not any model's skill. It has not yet been run end to end against a real model **and** real Kane. The `real-run` workflow does exactly that; its output, once run, is the evidence.
- `npm test` (15 tests) runs against `demo/fake-kane.mjs`, a **stand-in** for Kane. It validates Culprit's logic, not Kane's behaviour. Real-Kane evidence is the Proof section above.
- The Proof section was recorded on the history where a plain revert applies cleanly. The default seed (revert conflicts, so the agent is needed) has not been replayed on real Kane yet.
- Kane's `.evidence` packs and `test_url` are saved only when Kane writes them; fields Kane does not print stay empty and are never invented.
- The demo history is **seeded** (16 commits, one planted regression). Probe counts for bisect vs linear scan are measured in the same harness.
- First-parent history only; the regression must be monotonic. One test file and one app command per run.
- Not verified: whether `--on-lock-conflict readonly` is needed to avoid probe uploads to Kane.
