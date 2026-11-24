---
name: verify-branch-reports
description: Model-check how a branch's final answers reach its starter (board.route ordering, the judge checkpoint, the busy check at send time, restarts) with the TLA+ model in extensions/messages/test/model. Use before changing extensions/messages/route.ts, send.ts or the onYield hook in server.ts, when a review finds a report out of order, lost, sent twice or waking a busy branch's starter, or when `pnpm tla` fails.
---

# Verify branch reports

**The property:** a branch's answers reach its starter in answer order, each once, and a report wakes the starter only
while nothing of the branch is under way; once the branch is idle, its last word reported unless the judge called it
back-and-forth with the user.

**The harm when it breaks:** @ultimate acts on an older answer after a newer one (it happened three times in review
of one feature: `f05a2cbf`, `0c993799`, fixed for good by `f3c4c3da`), or wakes for a branch that is still working.

## Covered code

The model is `extensions/messages/test/model/BranchReports.tla`. Each action is one commit in the code:

| Action                        | Code                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `RunAnswers`                  | `server.ts` `onYield`: creates `board.route` with `after: started.lastRoute`                   |
| `RouteAnswered`               | `route.ts` phase `answered`: note, judge, `promoteLastNote` or nothing, in one commit          |
| `JudgeAsked` / `JudgeAnswers` | `route.ts` phase `judge`: memo `asked`, the call, memo `judged` with the `forward` checkpoint  |
| `JudgeInterrupted`            | `route.ts` phase `judge` rerun that finds `asked` without `judged`: `{ error: 'interrupted' }` |
| `Send`                        | `send.ts` `send`: the append transaction, its `ConversationRequestReceipts` and `stillReports` |
| `Complete`                    | `route.ts` phase `forward`: the terminal commit                                                |
| `Restart`                     | the host closes: in-process judge calls are lost, commits stay                                 |

`Busy` stands for `concludedOrWorkUnderway` in `route.ts` (run, queued input, open reply-expected messages). The model
counts conclusion and landing as busy, as the code does, and does not model them separately.

**Last checked:** the commit that adds this skill, on top of `7931aa6b` (`git log -1 --format=%h -- .ultimate/skills/verify-branch-reports/SKILL.md`).
If `git diff <that commit> -- extensions/messages/route.ts extensions/messages/send.ts extensions/messages/server.ts`
touches the rows above, read the model again before trusting a pass. Move this line forward only after you have
confirmed that each row still matches the code at the new commit.

## Bounds and what is left out

One branch, three inputs (two from the user whose answers are work updates, one reply-expected message from a
sibling), in any arrival order, one run at a time, at most one restart; the judge answers "report" or "note", or is
interrupted. About 3,300 states, a few seconds. Left out: concluding and landing as separate events, answers routed
back down from @ultimate, remote delivery, the 10 s judge timeout (a verdict like any other), and the judge's text.

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
