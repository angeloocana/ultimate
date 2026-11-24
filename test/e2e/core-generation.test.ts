import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { post, sourceCopy, temp, until } from '../helpers.ts'
import { fixture, homes } from './supervisor-helpers.ts'

type Answer = { facet: string; core: string | null; generation: string }

/** A built-in extension whose `which` action names its own version, the core it runs on and the generation serving it. */
const probe = (facet: string) => `export default { name: 'core-probe' }
export const actions = {
  which: () => ({
    facet: ${JSON.stringify(facet)},
    core: (globalThis as { coreProbe?: string }).coreProbe ?? null,
    generation: process.env.ULTIMATE_GENERATION,
  }),
}
`

async function which(url: string): Promise<Answer | undefined> {
  const { status, data } = await post(url, '/api/extensions/core-probe/actions/which').catch(
    () => ({ status: 0, data: undefined }),
  )
  return status === 200 ? (data.result as Answer) : undefined
}

// On 22-23 Nov four Ultimates sharing one clone ran the extensions of a newer checkout on their old core for a day
// ("agent is not a function"): only the Ultimate that asked for a restart got the new core.
describe('Ultimates sharing one clone', () => {
  it('reload extension edits, never run a newer checkout on an old core, and keep serving when the new core fails', async () => {
    const parent = await temp('ultimate-shared-clone-')
    homes.push(parent)
    const clone = await sourceCopy(parent)
    const facet = join(clone, 'extensions/core-probe/server.ts')
    await mkdir(join(clone, 'extensions/core-probe'))
    await writeFile(facet, probe('v1'))
    const hosts = [
      await fixture({ ultimateRoot: clone }),
      await fixture({ ultimateRoot: clone, project: await temp('project-', parent) }),
    ]
    for (const host of hosts) await until(async () => (await which(host.url))?.facet === 'v1')

    await writeFile(facet, probe('v1-edited'))
    for (const host of hosts)
      await until(async () => (await which(host.url))?.facet === 'v1-edited')
    for (const host of hosts)
      expect(await which(host.url)).toEqual({ facet: 'v1-edited', core: null, generation: '1' })

    const main = join(clone, 'server/main.ts')
    await writeFile(
      main,
      "(globalThis as { coreProbe?: string }).coreProbe = 'v2'\n" + (await readFile(main, 'utf8')),
    )
    await writeFile(facet, probe('v2'))
    const answers: Answer[] = []
    for (const host of hosts)
      await until(async () => {
        const answer = await which(host.url)
        if (answer) answers.push(answer)
        return answer?.facet === 'v2'
      }, 120_000)
    expect(answers.filter((answer) => answer.facet === 'v2' && answer.core !== 'v2')).toEqual([])
    for (const host of hosts)
      expect(await which(host.url)).toEqual({ facet: 'v2', core: 'v2', generation: '2' })

    await writeFile(join(clone, 'server/invalid.ts'), 'export const invalid: string = 7\n')
    await writeFile(facet, probe('v3'))
    await until(() => hosts.every((host) => host.output().includes('Core update pending')), 60_000)
    for (const host of hosts)
      expect(await which(host.url)).toEqual({ facet: 'v2', core: 'v2', generation: '2' })
  }, 300_000)
})
