import type { ConversationId, GenerationHooks, Tx } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { compile } from '@earendil-works/pi-schema'
import { expect, it, vi } from 'vitest'
import todosExtension, { actions, add, DONE_LIMIT, mark, noteFor, Todos } from '../server.ts'
import type { ActionContext } from '../../../server/actions.ts'
import type { TodosService } from '../api.ts'
import { createTestExtensionHost } from '../../../test/helpers.ts'

const ULTIMATE = 5 as ConversationId

/** A transaction over plain documents, keyed by kind and conversation; @ultimate is conversation 5. */
function fakeTx() {
  const docs = new Map<string, object>()
  return {
    docs,
    tx: {
      doc: async (
        { definition: def }: { definition: { kind: string; initial: () => object } },
        id: number,
      ) => {
        const key = `${def.kind}:${id}`
        if (!docs.has(key))
          docs.set(
            key,
            def.kind === 'ultimate.standing-agents' ? { ultimate: ULTIMATE } : def.initial(),
          )
        return docs.get(key)
      },
    } as unknown as Tx,
  }
}
const list = async (tx: Tx) => (await tx.doc(Todos, 1 as ConversationId)).items

it('adds to-dos by owner and refuses empty text or an unknown owner', async () => {
  const { tx } = fakeTx()
  expect(await add(tx, { text: '  Deploy fleet  ', owner: 'ultimate' })).toEqual({
    id: 1,
    text: 'Deploy fleet',
    owner: 'ultimate',
    at: expect.any(Number),
  })
  expect(await add(tx, { text: 'Rotate the key', owner: 'user' })).toMatchObject({
    id: 2,
    owner: 'user',
  })
  await expect(add(tx, { text: ' ', owner: 'user' })).rejects.toThrow('nonempty')
  await expect(add(tx, { text: 'x', owner: 'lander' })).rejects.toThrow('owner')
  expect((await list(tx)).map((todo) => todo.id)).toEqual([1, 2])
})

it('adds through TodosApi once per key, even after the to-do left the list', async () => {
  const { tx } = fakeTx()
  let service: TodosService | undefined
  const host = createTestExtensionHost({
    implement: (_api: unknown, value: TodosService) => (service = value),
    harness: () => ({ commit: (fn: (tx: Tx) => unknown) => fn(tx) }),
  })
  todosExtension(host)
  const fields = { text: 'Call back', owner: 'user', priority: 'high', due: '2028-02-29' } as const
  const first = await service!.add({ ...fields, key: 'mail-42' })
  expect(first).toMatchObject({ id: 1, ...fields })
  const edited = await actions.update({ id: first.id, priority: 'low' }, { host } as ActionContext)
  expect(edited).toEqual({ ...first, priority: 'low' })
  expect(await service!.add({ ...fields, key: 'mail-42' })).toEqual(edited)
  expect((await list(tx)).map((todo) => todo.id)).toEqual([1])
  // Ticked out of the list: the key still returns the to-do as it was added, and adds nothing.
  ;(await tx.doc(Todos, 1 as ConversationId)).items = []
  expect(await service!.add({ ...fields, key: 'mail-42' })).toEqual(first)
  expect(await list(tx)).toEqual([])
})

it('adds and edits through user actions, clearing the due date without changing ownership', async () => {
  const { tx } = fakeTx()
  const host = createTestExtensionHost({
    harness: () => ({ commit: (fn: (tx: Tx) => unknown) => fn(tx) }),
  })
  const ctx = { host } as ActionContext
  const fields = { text: 'Ship it', owner: 'user', priority: 'normal', due: '2026-11-23' }
  const added = await actions.add(fields, ctx)
  expect(added).toMatchObject(fields)
  const updated = await actions.update(
    { id: added.id, text: '  Ship on Tuesday  ', priority: 'high', due: '2026-11-24' },
    ctx,
  )
  expect(updated).toEqual({
    ...added,
    text: 'Ship on Tuesday',
    priority: 'high',
    due: '2026-11-24',
  })
  const cleared = await actions.update({ id: added.id, due: null }, ctx)
  expect(cleared).toEqual({
    id: added.id,
    at: added.at,
    text: 'Ship on Tuesday',
    owner: 'user',
    priority: 'high',
  })
  expect(await list(tx)).toEqual([cleared])
})

it('ticks and reopens a to-do, keeping only the newest done ones', async () => {
  const { tx } = fakeTx()
  for (let i = 0; i < DONE_LIMIT + 2; i++) await add(tx, { text: `t${i}`, owner: 'ultimate' })
  const first = await mark(tx, 1, true)
  expect(first.done).toBeTypeOf('number')
  expect((await mark(tx, 1, false)).done).toBeUndefined()
  // Everything but the last was ticked long ago, in id order; ticking the last drops the two oldest ticks.
  for (const todo of (await list(tx)).slice(0, -1)) todo.done = todo.id
  await mark(tx, DONE_LIMIT + 2, true)
  const ids = (await list(tx)).map((todo) => todo.id)
  expect(ids).toEqual(Array.from({ length: DONE_LIMIT }, (_, i) => i + 3))
  await expect(mark(tx, 999, true)).rejects.toThrow('No to-do 999')
})

it('tells @ultimate the open list only when it changed', async () => {
  const { tx } = fakeTx()
  const content = async () => (await noteFor(tx, ULTIMATE, 0))?.entries[0].model[0].content
  expect(await content()).toBeUndefined()
  await add(tx, { text: 'Mine', owner: 'ultimate' })
  await add(tx, { text: 'Theirs', owner: 'user' })
  expect(await content()).toBe(
    "Open to-dos (todo tool: done when finished):\nYours:\n- 1: Mine\nThe user's:\n- 2: Theirs",
  )
  expect(await content()).toBeUndefined()
  await mark(tx, 1, true)
  await mark(tx, 2, true)
  expect(await content()).toBe('No to-dos are open.')
  expect(await content()).toBeUndefined()
})

it('updates the open note at local midnight on the due day and the next day only', async () => {
  const { tx } = fakeTx()
  const due = '2026-11-23'
  await add(tx, { text: 'Submit the form', owner: 'user', priority: 'high', due })
  const content = async (day: number, hour = 0) =>
    (await noteFor(tx, ULTIMATE, new Date(2026, 10, day, hour).getTime()))?.entries[0].model[0]
      .content
  expect(await content(21)).toContain(`priority: high, due: ${due}]`)
  expect(await content(22, 23)).toBeUndefined()
  expect(await content(23)).toContain(`due: ${due} (today)`)
  expect(await content(23, 23)).toBeUndefined()
  expect(await content(24)).toContain(`due: ${due} (overdue)`)
  expect(await content(25)).toBeUndefined()
})

it("keeps the todo tool to @ultimate and the note to @ultimate's inputs", async () => {
  const { tx } = fakeTx()
  const extension = todosExtension(createTestExtensionHost({ implement: () => {} }))
  const tool = extension.tools!.find((candidate) => candidate.name === 'todo')!
  const run = (conversationId: number, args: object) =>
    tool.execute(
      args as never,
      { conversationId, commit: (fn: (tx: Tx) => unknown) => fn(tx) } as never,
      undefined as never,
    )
  await expect(run(9, { action: 'list' })).rejects.toThrow('Only @ultimate')
  const input = {
    action: 'add',
    text: 'Ship it',
    owner: 'user',
    priority: 'high',
    due: '2026-11-23',
  }
  expect(compile(tool.parameters).check(input)).toBe(true)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 23, 12).getTime())
  try {
    expect(await run(ULTIMATE, input)).toEqual({
      output: [
        {
          type: 'text',
          text: 'Added 1 for user [priority: high, due: 2026-11-23 (today)]: Ship it',
        },
      ],
    })
    expect(await run(ULTIMATE, { action: 'list' })).toEqual({
      output: [
        {
          type: 'text',
          text: "The user's:\n- 1 [priority: high, due: 2026-11-23 (today)]: Ship it",
        },
      ],
    })
    expect((await list(tx))[0]).toMatchObject({ priority: 'high', due: '2026-11-23' })
  } finally {
    clock.mockRestore()
  }
  const hooks = extension.hooks![0].handlers as GenerationHooks
  const before = (conversationId: ConversationId) =>
    hooks.beforeInput(
      {} as never,
      { tx, conversationId, agent: () => Promise.reject(new Error('Unused')) },
      BACKGROUND_CONTEXT,
    )
  expect(await before(9 as ConversationId)).toBeUndefined()
  expect(await before(ULTIMATE)).toBeDefined()
})
