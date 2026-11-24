---
name: verify-lander-checks
description: Model-check how the lander records a check's first run, its one rerun and the flaky note across host restarts, with the TLA+ model in extensions/workspaces/test/model. Use before changing runCheckWithOneDurableRerun, the lander's step commit or QueueEntry.checks in extensions/workspaces/lander.ts, when a review finds a check rerun after a restart or a flaky note lost, or when `pnpm tla` fails on LanderChecks.
---

# Verify lander checks

**The property:** a check run whose result the lander logged never runs again; a rerun happens only after a logged
first-run failure; and once a first-run failure is logged, the landing never counts the check as passed and its flaky
note carries the first run's cause.

**The harm when it breaks:** after a host restart the lander reruns a check it already logged, and a flaky check lands
as passed with no flaky note, so nobody fixes it. It happened twice in review of one feature: `8985e550` (a restart
after the cause memo reran the first run) and `c1685d08`'s split writes (a restart after the log step does the same).

## Covered code

The model is `extensions/workspaces/test/model/LanderChecks.tla`. Each action is one durable step in
`extensions/workspaces/lander.ts`:

| Action                 | Code                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Resume`               | `runCheckWithOneDurableRerun` reads `QueueEntry.checks[<attempt>:<position>]` from the `Workspaces` doc     |
| `Run(1)`               | `run(command, member)` after the `checking:` step                                                           |
| `Run(2)`               | `run(command, member)` after the `rerunning:` step                                                          |
| `Record(1)`            | `step('checked: …', { outcome })`: log entry, `CheckRan` and the saved outcome in one commit                |
| `Record(2)`            | the same commit for a passing rerun; for a failing one the commit that saves the rerun and emits `CheckRan` |
| `Restart`              | the host closes: the run in memory is lost, commits stay                                                    |
| `Log`, `Cause`, `Memo` | the older modes only: separate log commit, `:cause` memo and first-run or `:rerun` memo                     |

The flaky note is `Landed.flaky`, built from `outcome.cause`. A landing in flight when this code first ran reads its
older memos once (`outcomeMemoizedBeforeUpgrade`); the model does not cover that one-time path.

**Last checked:** the commit that adds this skill, on top of `9d04104c`
(`git log -1 --format=%h -- .ultimate/skills/verify-lander-checks/SKILL.md`). If
`git diff <that commit> -- extensions/workspaces/lander.ts extensions/workspaces/types.ts` touches the rows above,
read the model again before trusting a pass. Move this line forward only after you have confirmed that each row still
matches the code at the new commit.

## Bounds and what is left out

One check of one landing attempt, a first run and one rerun, each passing or failing, and at most two restarts at
any step. Under 200 states per config, about a second each. Left out: check groups (members run side by side and save
under their own keys), a second landing attempt after the target moved (its checks start over under a new attempt
number), the watchdog (a stopped check is a failed run), push and fast-forward, and what the check prints.

Not exactly-once: a command interrupted before its `checked:` commit runs again after the restart, and the model
allows that.

## Run it

```sh
pnpm tla
```

It checks four LanderChecks configs, each against the expectation on its first line:

- `LanderChecks.cfg`: the code as it is; every invariant must hold.
- `LanderChecksSplitWrites.cfg`: log, cause memo and first-run memo as separate writes, as from `c1685d08` until this
  model; must break `RecordedRunNotRepeated`.
- `LanderChecksSplitWritesLoseCause.cfg`: the same split; must break `DiagnosisKept` (the flaky note lost).
- `LanderChecksCauseMemoFirst.cfg`: the cause memo before the log step, as in `8985e550`; must break `DiagnosisKept`.

The broken variants prove the check can fail. A broken variant that starts passing means the model no longer reaches
that bug: fix the model, never the expectation.

Tooling: Java 11+ (`brew install openjdk@21`) and TLC 1.7.4, which `scripts/tla.ts` downloads once into
`~/.cache/ultimate/` and checks against its pinned sha256. The lander runs `pnpm tla` on every landing.

## Real-database replay

"resumes checks after a restart without rerunning passed ones and keeps flaky notes" in
`extensions/workspaces/test/e2e/workspaces-integration.test.ts` closes the harness right after the failed first run's
`CheckRan` commits, the step where `LanderChecksSplitWritesLoseCause.cfg` restarts, and reopens it on the same SQLite
database. On the split writes it loses the flaky note; on the code as it is it keeps it. Run it with
`pnpm test:e2e extensions/workspaces/test/e2e/workspaces-integration.test.ts -t "keeps flaky notes"`.

## Read a failure

Read every TLC result, a counterexample or a pass, with the `/statechart` skill: it tells an invariant violation as
its shortest path in plain words, and draws the passing model as a chart. Then translate each step back through the
table above and replay it against the real code, one step per action, closing the harness where the path restarts. If
the replay does not fail, suspect the model first: a step it treats as one commit that the code splits, or a read it
forgot. If it does fail, it is a real bug: report the path in the code's words and don't weaken the invariant.

## Change the model with the code

When a change to the covered code is intended, update the matching action, run `pnpm tla`, make sure every broken
variant still fails for its reason, add a replay for any new bug path, and move **Last checked** forward.
