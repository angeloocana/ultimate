---
name: daily-fork-sync
description: Sync upstream into Ultimate's fork, preserve fork features, and validate the merge on Google Cloud. Use for the daily upstream sync or a manual catch-up.
---

# Daily fork sync

1. In a clean coordinator worktree based on fork `main`, run `git fetch upstream main`. Stop if upstream is already
   merged. Build the fork-feature checklist from `git log upstream/main..main --no-merges --oneline`. Check which
   features overlap upstream's changes, even where Git merges without a conflict.
2. Run `git merge upstream/main`; resolve conflicts so both upstream and fork features still work. Never rebase,
   reset or force-push. Run `pnpm install` if `pnpm-lock.yaml` changed. On the Mac, run only `pnpm check` and focused
   tests for the overlapping areas.
3. Validate the exact tip on Google Cloud. If today's `sync/<date>` ref already exists on `origin`, coordinate
   before touching it. Set `fork_url` to the fork's public HTTPS clone URL, then run:

   ```bash
   ref="sync/$(date +%F)"
   git push origin "HEAD:refs/heads/$ref" &&
     CLOUD_RUN_SETUP='apt-get -qq install -y ffmpeg' ~/.ultimate/bin/cloud-run.sh "$fork_url" "$ref" \
       'pnpm install && pnpm test && pnpm exec playwright-core install --with-deps chromium && pnpm test:e2e'
   ```

   Check the cloud exit status and that it tested your tip. Delete the temporary branch you pushed with
   `git push origin --delete "$ref"` even if validation fails. If you fix the merge, test the new tip before submitting.

4. Once checks pass, use `workspace submit`; the lander handles `main`. Report in 3–5 lines: upstream and submitted
   SHAs, where upstream overlapped fork features and what you verified, Mac/cloud results and cleanup, and whether
   the landing needs a restart.
