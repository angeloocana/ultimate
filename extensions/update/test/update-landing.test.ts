import { expect, it } from 'vitest'
import { coreChangedSince } from '../server.ts'
import { needsRestart } from '../../../lib/layers.ts'

it('asks for a restart after a landing that changes the core, the lockfile or a patch', () => {
  expect(needsRestart(['extensions/a.ts', 'server/main.ts'])).toBe(true)
  expect(needsRestart(['extensions/a.ts', 'pnpm-lock.yaml'])).toBe(true)
  // Landings c16450c, 983ad97 and e609be7 changed only this patch: their cards asked for no restart.
  expect(needsRestart(['patches/@earendil-works__pi-claude-code@0.1.0.patch'])).toBe(true)
  expect(needsRestart(['extensions/a.ts', 'docs/pnpm-lock.yaml.md'])).toBe(false)
})

/** A clone whose commits since `boot` change `files`; git's pathspec keeps only `server/` and `shared/`. */
const cloneSince =
  (files: string[]) =>
  async (...args: string[]) => {
    expect(args).toEqual(['diff', '--name-only', 'boot', 'HEAD', '--', 'server', 'shared'])
    return files.filter((file) => /^(server|shared)\//.test(file)).join('\n')
  }

// Commit 90fa141 changed server/ with an extension: the extension hot-reloaded, the old core refused it, and no restart
// was asked for since no packages were installed.
it('asks for a restart when HEAD changed the core since boot, not for extensions alone', async () => {
  expect(
    await coreChangedSince(
      cloneSince(['server/extensions.ts', 'extensions/mcp/server.ts']),
      'boot',
    ),
  ).toBe(true)
  expect(await coreChangedSince(cloneSince(['extensions/mcp/server.ts']), 'boot')).toBe(false)
})
