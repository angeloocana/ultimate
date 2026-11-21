/** @jsxImportSource @solidjs/web */
import { createSignal, flush } from 'solid-js'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'
import { SELECTED, UNLOADED } from '../../items.ts'
import type { Entry, Selection } from '../../items.ts'
import { useSelection } from '../../selection.solid.tsx'

const harness = vi.hoisted(() => ({ writes: [] as unknown[], failures: 0, rejections: 0 }))
vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  return {
    store: { getState: () => ({}), subscribe: () => undefined },
    uiState: createUiState(
      async (request) => {
        harness.writes.push(request.ops[0].value)
        if (harness.failures < harness.rejections) throw new Error('server down')
        return { ok: true, rev: harness.writes.length }
      },
      { delayMs: 0, onError: () => harness.failures++ },
    ),
  }
})

import { uiState } from '../../../../web/src/sdk/client.ts'

const entry = (key: string, at: number) => ({ key, at }) as Entry
const [a, b] = [entry('a', 10), entry('b', 20)]

function load() {
  let show!: (entries: Entry[], ready: boolean) => void
  let choose!: (next: Selection) => void
  function Probe() {
    const [entries, setEntries] = createSignal<Entry[]>([])
    const [ready, setReady] = createSignal(false)
    show = (next, loaded) => {
      setEntries(next)
      setReady(loaded)
    }
    const state = useSelection(entries, ready)
    choose = state.setSelected
    return <span>{state.item()?.key}</span>
  }
  const container = renderSolid(() => <Probe />)
  const settled = async () => {
    flush()
    await uiState.flush()
    flush()
  }
  return {
    show: async (entries: Entry[], ready = true) => {
      show(entries, ready)
      await settled()
      return container.textContent
    },
    choose: (next: Selection) => {
      choose(next)
      return settled()
    },
  }
}

beforeEach(() => {
  Object.assign(harness, { writes: [], failures: 0, rejections: 0 })
  uiState.receive({ [SELECTED]: null })
  flush()
})

it('keeps a selected to-do while its source loads and advances when it is actually done', async () => {
  const page = load()
  const todo = entry('todo:7', 15)
  uiState.receive({ [SELECTED]: { key: todo.key, at: todo.at, open: true } })
  expect(await page.show([a, b], false)).toBe('')
  expect(harness.writes).toEqual([])
  expect(await page.show([a, todo, b])).toBe(todo.key)
  expect(harness.writes).toEqual([])
  expect(await page.show([a, b])).toBe(b.key)
  expect(harness.writes).toEqual([{ key: b.key, at: b.at, open: true }])
})

it('sends a rejected handoff or repair of a late link’s age once, not in a loop', async () => {
  const page = load()
  harness.rejections = 4
  uiState.receive({ [SELECTED]: { key: 'b', at: 20, open: true } })
  await page.show([a])
  await page.show([a])
  expect(harness.writes).toEqual([{ key: 'a', at: 10, open: true }])

  uiState.receive({ [SELECTED]: { key: 'b', at: UNLOADED, open: true } })
  await page.show([a, b])
  await page.show([a, b])
  expect(harness.writes.slice(1)).toEqual([{ key: 'b', at: 20, open: true }])
  expect(harness.failures).toBe(2)
})

it('repairs a second link and hands off a returning entry again each time', async () => {
  const page = load()
  uiState.receive({ [SELECTED]: { key: 'b', at: UNLOADED, open: true } })
  await page.show([a, b])
  await page.choose({ key: 'a', at: 10, open: true })
  await page.choose({ key: 'b', at: UNLOADED, open: true })
  await page.show([a, b])
  expect(uiState.get(SELECTED)).toEqual({ key: 'b', at: 20, open: true })

  await page.show([a])
  await page.show([a, b])
  await page.choose({ key: 'b', at: 20, open: true })
  await page.show([a])
  expect(harness.writes.filter((value) => (value as Selection)?.key === 'a')).toHaveLength(3)
  expect(uiState.get(SELECTED)).toEqual({ key: 'a', at: 10, open: true })
})
