import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, inject, it, vi } from 'vitest'
import { context } from '../../server/harness.ts'
import { extensionGraph } from '../../scripts/deps.ts'
import { defaultOff } from '../../shared/extension-api.ts'
import { fauxServer, removeTemp, temp } from '../helpers.ts'

// Each case boots its own server on its own home; a few at a time keep the machine responsive.
vi.setConfig({ maxConcurrency: 6 })

const graph = extensionGraph(resolve('extensions'))
const optional = [...graph].filter(([, entry]) => !entry.core).map(([name]) => name)
const defaultOn = optional.filter((name) => !defaultOff.includes(name))
const core = [...graph].filter(([, entry]) => entry.core).map(([name]) => name)
const enabledByDefault = [...core, ...defaultOn].toSorted()

/** A faux server on the built-ins with `disable` in the user's settings, and what it reports. */
async function boot(disable: readonly string[]) {
  const home = await temp('ultimate-disable-each-')
  await mkdir(join(home, 'project'))
  await mkdir(join(home, '.ultimate'))
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { disable } }),
  )
  const server = await fauxServer({
    ultimateRoot: inject('prebuiltWeb').root,
    projectRoot: join(home, 'project'),
    userHome: home,
    home: join(home, 'state'),
  })
  try {
    const info = server.extensions.info()
    const agent = await server.root.agent(context)
    expect(info.flatMap((entry) => (entry.server?.error ? [entry.name] : []))).toEqual([])
    expect(server.extensions.catalogue().missing).toEqual([])
    return {
      enabled: info.filter((entry) => entry.enabled).map((entry) => entry.name),
      diagnostics: server.system.current().extensionDiagnostics,
      tools: agent.tools.map((tool) => tool.name),
    }
  } finally {
    await server.close()
    await removeTemp(home)
  }
}

it('knows optional extensions and the core tier', () => {
  expect(optional.length).toBeGreaterThan(10)
  expect(core).toEqual(expect.arrayContaining(['conversations', 'subagents', 'workspaces']))
})

it.concurrent.each(defaultOn)('boots cleanly with %s disabled', async (name) => {
  const state = await boot([name])
  expect(state.enabled.toSorted()).toEqual(enabledByDefault.filter((entry) => entry !== name))
  expect(state.diagnostics).toEqual([])
  expect(state.tools).toContain('bash')
})

it.concurrent('boots cleanly with all default-off extensions explicitly disabled', async () => {
  const state = await boot(defaultOff)
  expect(state.enabled.toSorted()).toEqual(enabledByDefault)
  expect(state.diagnostics).toEqual([])
  expect(state.tools).toContain('bash')
})

it.concurrent('keeps every core-tier extension enabled when settings disable them all', async () => {
  const state = await boot(core)
  expect(state.enabled).toEqual(expect.arrayContaining(core))
  expect(state.diagnostics.toSorted()).toEqual(
    core
      .map((name) => `${name} is core and stays enabled; extensions.disable ignores it`)
      .toSorted(),
  )
  expect(state.tools).toEqual(expect.arrayContaining(['bash', 'subagent']))
})
