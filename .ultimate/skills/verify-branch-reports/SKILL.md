---
name: verify-branch-reports
description: Model-check how a branch's final answers reach its starter (board.route ordering, the judge checkpoint, the busy check at send time, restarts) with the TLA+ model in extensions/messages/test/model. Use before changing extensions/messages/route.ts, send.ts or the onYield hook in server.ts, when a review finds a report out of order, lost, sent twice or waking a busy branch's starter, or when `pnpm tla` fails.
---

# Verify branch reports

**The property:** sends to the starter preserve answer order, and each route sends at most once. A send is marked
as a wake-up report only if the branch is idle at the send. After all inputs and routes finish, the last send, if
any, is a report unless the judge called it back-and-forth with the user.

**The harm when it breaks:** @ultimate acts on an older answer after a newer one (it happened three times in review
of one feature: `f05a2cbf`, `0c993799`, fixed for good by `f3c4c3da`), or wakes for a branch that is still working.

## Covered code

The model is `extensions/messages/test/model/BranchReports.tla`. Each action is one durable step in the code (a commit,
or a memo with the call it guards):

| Action                        | Code                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `RunYields`                   | `server.ts` `onYield` calls `observeRun`: creates `board.route` with `after: started.lastRoute` |
| `RunEnds`                     | the generation task settles, which phase `observe` waits on; the inbox moves on                 |
| `RouteAnswered`               | `route.ts` phase `answered`: note, judge, `promoteLastNote` or `landed` if there is no send     |
| `JudgeAsked` / `JudgeAnswers` | `route.ts` phase `judge`: memo `asked`, call through `judge.ts`, memo `judged` with the verdict |
| `JudgeInterrupted`            | `route.ts` phase `judge` rerun that finds `asked` without `judged`: `{ error: 'interrupted' }`  |
| `JudgeCommitted`              | `route.ts` phase `judge`: the commit of `Judgements` and the `forward` checkpoint               |
| `Send`                        | `send.ts` `send`: the append transaction, its `ConversationRequestReceipts` and `stillReports`  |
| `Forwarded`                   | `route.ts` phase `forward`: commits the `landed` checkpoint after sending                       |
| `Complete`                    | `route.ts` phase `landed`: the terminal commit that releases the next route's `after` wait      |
| `Restart`                     | the host closes: in-process judge calls are lost, commits stay                                  |

`Busy` represents the run and queued inputs in `concludedOrWorkUnderway` in `route.ts`. The code also checks for
conclusion, a pending landing, reply-expected messages, pending wake tasks and busy subagents. Phase `landed` can wait
for delivery placement before calling `WorkspacesApi.settleLanded`. The model represents the checkpoint and terminal
commit, not the workspace settlement or its delivery guards.

**Last checked:** `601561aa3e300849b78b550be4e71f05fa22b0ae`.
If `git diff <that commit> -- extensions/messages/{route,send,server,judge}.ts` touches the rows above, read the
model again before trusting a pass. Move this line forward only after you have confirmed that each row still
matches the code at the new commit.

## Bounds and what is left out

One branch, three inputs (two from the user whose answers are work updates, one reply-expected message from a
sibling), in any arrival order, one run at a time, at most one restart; the judge answers "report" or "note", or is
interrupted. About 6,100 states, a few seconds. Left out: concluding and landing as separate events, tool-ended
runs (`terminateRun` also creates a route but captures no inputs), answers routed down from @ultimate, delivery
after the send transaction, the 10 s judge timeout, and the judge's text.

## Run it

```sh
pnpm tla
```

It checks three configs, each against the expectation on its first line:

- `BranchReports.cfg`: the code as it is; every invariant must hold.
- `BranchReportsWithoutPredecessor.cfg`: routes without `after`, as before `f3c4c3da`; must break `AnswersInOrder`.
- `BranchReportsJudgedOnlyBusyCheck.cfg`: `stillReports` for judged reports only, as before this model found it;
  must break `ReportsOnlyWhenIdle`.

The two broken variants prove the check can fail. A broken variant that starts passing means the model no longer
reaches that bug: fix the model, never the expectation.

Tooling: Java 11+ (`brew install openjdk@21`) and TLC 1.7.4, which `scripts/tla.ts` downloads once into
`~/.cache/ultimate/` and checks against its pinned sha256. The lander runs `pnpm tla` on every landing.

## Real-database replays

Each model bug has a replay in `extensions/messages/test/messages.test.ts` on the SQLite fixture:

- "keeps answer order across a restart while an older verdict waits and a newer report is ready (f3c4c3da)"
- "sends a promoted note as a note when the branch got busy before it went out"
- "judges and sends a branch's answers in answer order, and a report judged while it is busy waits for its next report"

Run them with `pnpm test extensions/messages/`.

## Read a failure

Read every TLC result, a counterexample or a pass, with the `/statechart` skill: it tells an invariant violation as
its shortest path in plain words, and draws the passing model as a chart. Then translate each step back through the
table above and replay it against the real code as a test, one step per action. If the replay does not fail, suspect
the model first: a step the model treats as atomic that the code splits, or a guard the model forgot. If it does
fail, it is a real bug: report the path in the code's words and don't weaken the invariant.

## Change the model with the code

When a change to the covered code is intended, update the matching action, run `pnpm tla`, make sure both broken
variants still fail for their reason, add a replay for any new bug path, and move **Last checked** forward.
