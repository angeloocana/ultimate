/** @jsxImportSource @solidjs/web */
import { createAgent } from '@ui-sdk/solid/agent'
import { settle } from '@ui-sdk/core/testing'
import { flush } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button.solid.tsx'
import { ExtensionName, definePoint, provide } from '@/sdk/solid'
import { SOURCE_HEADER } from '../../../../shared/protocol.ts'
import type { SystemInfo } from '../../../../shared/protocol.ts'
import type { FakeSource, fakeSubscriptions } from '../../../../test/web/fake-source.ts'
import { expectDistinctAgentNames } from '../../../../test/web/agent-names.ts'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'
import type { Todo } from '../../refs.ts'

const harness = vi.hoisted(() => ({
  sources: [] as FakeSource[],
  actions: [] as { name: string; args: unknown; source: string | null }[],
  subscriptions: undefined as ReturnType<typeof fakeSubscriptions> | undefined,
}))
vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createStore } = await import('../../../../web/src/sdk/store.ts')
  const { createApi } = await import('../../../../web/src/sdk/api.ts')
  const { createReads } = await import('../../../../web/src/sdk/reads.ts')
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  const { createRegistry } = await import('../../../../web/src/sdk/registry.ts')
  const { FakeSource, fakeSubscriptions } = await import('../../../../test/web/fake-source.ts')
  const subscriptions = fakeSubscriptions(harness.sources, (path, init) => fetch(path, init))
  harness.subscriptions = subscriptions
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = input as string
    const source = new Headers(init?.headers).get(SOURCE_HEADER)
    if (path === '/api/extensions/inbox/actions/submitFollowUp') {
      const { args, conversationId } = JSON.parse(init!.body as string)
      harness.actions.push({ name: 'submitFollowUp', args: { ...args, conversationId }, source })
      return Response.json({ result: { to: conversationId, submissionId: 412, at: Date.now() } })
    }
    if (path === '/api/extensions/inbox/actions/followUpStatus') {
      return Response.json({ result: { status: 'replied' } })
    }
    if (path === '/api/extensions/subagents/actions/standing') {
      harness.actions.push({
        name: 'standing',
        args: JSON.parse(init!.body as string).args,
        source,
      })
      return Response.json({ result: 69 })
    }
    const action = /^\/api\/extensions\/todos\/actions\/(\w+)$/.exec(path)
    if (!action) return subscriptions.handle(path, init) ?? Response.json({ ok: true })
    const { args } = JSON.parse(init!.body as string) as { args: unknown }
    harness.actions.push({ name: action[1], args, source })
    return Response.json({ result: {} })
  }
  const store = createStore({
    eventSource: (url) => {
      const stream = new FakeSource(url)
      harness.sources.push(stream)
      return stream
    },
    fetch,
  })
  const api = createApi(store, { fetch })
  return {
    store,
    api,
    reads: createReads(api, store),
    registry: createRegistry(),
    uiState: createUiState(api.updateUi),
  }
})

import { registry, store } from '../../../../web/src/sdk/client.ts'
import { InboxTodoControls, TodoPane, TodoText } from '../../inbox.solid.tsx'

const agent = createAgent()
const todo = (id: number, owner: Todo['owner'], text: string): Todo => ({
  id,
  owner,
  text,
  at: Date.now() - 60_000,
})
const control = (label: string, component: string) => {
  const found = agent
    .snapshot()
    .find((entry) => !entry.offPage && entry.label === label && entry.component === component)
  if (!found) throw new Error(`Missing ${component}: ${label}`)
  return found
}

it('makes references from a user extension actionable in the opened to-do', async ({
  onTestFinished,
}) => {
  const point = definePoint<{ id: number; text: string }, unknown>('todos.references')
  const open = vi.fn<(id: number, text: string) => void>()
  await registry.setLoaders({
    'extensions/references/web.solid.tsx': async () => ({
      default: {
        provides: [
          provide(point, (props: { id: number; text: string }) => (
            <Button onClick={() => open(props.id, props.text)}>Open referenced document</Button>
          )),
        ],
      },
    }),
  })
  onTestFinished(() => registry.setLoaders({}))
  const item = todo(12, 'user', 'Follow the instructions in docs/setup.md')
  renderSolid(() => <TodoPane todo={item} />)
  await settle()
  flush()

  const result = await agent.act({
    steps: [{ ref: control('Open referenced document', 'button').ref, action: 'press' }],
  })
  expect(result.ok).toBe(true)
  expect(open).toHaveBeenCalledExactlyOnceWith(12, item.text)
})

it('links web and Obsidian URLs in a to-do without enclosing punctuation', () => {
  const web = 'https://example.com/a?b=1'
  const note = 'obsidian://open?vault=my-vault&file=Project%20Notes'
  const text = `Think (${note}), then see ${web}.`
  const container = renderSolid(() => <TodoText text={text} />)
  expect(container.textContent).toBe(text)
  expect([...container.querySelectorAll('a')].map((link) => [link.textContent, link.href])).toEqual(
    [
      [note, note],
      [web, web],
    ],
  )
})

it('adds, edits, acts on and follows up Inbox to-dos as the agent that pressed the control', async ({
  onTestFinished,
}) => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  store.start()
  onTestFinished(() => store.stop())
  harness.sources[0].open()
  const showChapter = async (path: string, generation: number) => {
    harness.sources[0].send('system', {
      process: { pid: 10, generation },
      persistence: { path },
    } as unknown as SystemInfo)
    await settle()
    flush()
  }
  await showChapter('/project/state.sqlite', 1)
  const item = todo(3, 'user', 'Renew the cert')
  renderSolid(() => (
    <ExtensionName value="todos">
      <InboxTodoControls />
      <TodoPane todo={item} />
    </ExtensionName>
  ))
  await settle()
  flush()
  const press = async (label: string) => {
    const result = await agent.act({
      steps: [{ ref: control(label, 'button').ref, action: 'press' }],
    })
    expect(result).toMatchObject({ ok: true })
    await settle()
    flush()
  }
  const set = async (label: string, component: string, value: string) => {
    const result = await agent.act({
      steps: [{ ref: control(label, component).ref, action: 'setValue', args: [value] }],
    })
    expect(result).toMatchObject({ ok: true })
    await settle()
    flush()
  }

  await expectDistinctAgentNames(agent)
  await press('Open add to-do form')
  await expectDistinctAgentNames(agent)
  await set('To-do text', 'textarea', 'Ship it')
  await set('To-do owner', 'segmented-control', 'ultimate')
  await set('Priority', 'segmented-control', 'high')
  await set('Due date', 'input', '2027-07-20')
  await press('Create to-do')
  expect(harness.actions).toContainEqual({
    name: 'add',
    args: { text: 'Ship it', owner: 'ultimate', priority: 'high', due: '2027-07-20' },
    source: 'agent',
  })

  await press('Edit')
  await set('To-do text', 'textarea', 'Renew the production cert')
  await press('Save changes')
  expect(harness.actions.some(({ name }) => name === 'submitFollowUp')).toBe(false)
  await set('Prompt for @ultimate', 'textarea', 'Which cert store?')
  const prompt = () =>
    document.querySelector<HTMLTextAreaElement>('[data-ui="prompt-composer"] textarea')?.value
  await showChapter('/project/chapters/new/state.sqlite', 2)
  expect(prompt()).toBe('')
  await showChapter('/project/state.sqlite', 3)
  expect(prompt()).toBe('Which cert store?')
  await press('Send prompt to @ultimate')
  expect(document.querySelector('[data-todo-pane="3"]')?.textContent).toMatch(
    /Sent to.*#69.*Reply arrived.*Open conversation/,
  )
  await press('Mark done')
  expect(harness.actions).toContainEqual({
    name: 'update',
    args: { id: 3, text: 'Renew the production cert' },
    source: 'agent',
  })
  expect(harness.actions).toContainEqual({ name: 'done', args: { id: 3 }, source: 'agent' })
  expect(harness.actions).toContainEqual({
    name: 'standing',
    args: { name: 'ultimate' },
    source: 'agent',
  })
  expect(harness.actions).toContainEqual({
    name: 'submitFollowUp',
    args: {
      conversationId: 69,
      item: 'todo:3',
      text: 'About my to-do #3: Renew the cert\n\nWhich cert store?',
      images: [],
    },
    source: 'agent',
  })
  expect(harness.subscriptions?.reads.map(({ read }) => read)).toContainEqual({
    extension: 'inbox',
    action: 'followUpStatus',
    args: { submissionId: 412 },
    conversation: 69,
  })
})
