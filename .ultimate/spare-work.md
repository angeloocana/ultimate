# Spare work

What @ultimate starts when automation A22 (`~/.ultimate/bin/spare-dispatch.mjs`) sends "Spare capacity dispatch": a
subscription is on pace to end its week under 98 %. Each message is one fire. A local `.ultimate/spare-dispatch-off`
file pauses dispatches here.

## On each fire

1. Start one coordinator branch on the family the message names (`lead`, `sol`, `neon`) for the first unchecked item
   below, and mark it `[~] #<branch>`. Never put Codex (`sol`) on security or auth work.
2. Check `uptime` first; start only under a 1-minute load of about 12.
3. Each item is one branch, sized small or assess-first as written. Landing follows AGENTS.md. Anything that changes
   behaviour the user sees ends as an assessment for the user, not a landing.
4. When the item lands or is dropped, mark it `[x]` with the sha or the reason.

## Backlog

- [ ] Leaner tests: find the next three slowest test files (after `disable-each`, automations and workspaces) and cut
  setup waste without dropping any behaviour, security or past-bug check. Small; measure before and after.
- [ ] Flaky test: `extensions/automations/test/e2e/automations-scripts.test.ts` > "resets a script when an update
  changes its ask or once" failed once in the lander on 28 Nov (`d0f4654`) and passed on rerun. Find the race and fix
  it, or delete the test if it proves nothing. Small.
- [ ] Core-generation gaps from #24384: a web build finishing in the moment the core changes can still go live; a host
  showing "Core update pending" re-checks core files on every page request. Assess first.
- [ ] Remove dead exports and test-only re-exports found by #27863 (unused exports, two test-only re-exports). Small.
