/** @jsxImportSource @solidjs/web */
import { createAgent } from '@ui-sdk/solid/agent'
import { settle } from '@ui-sdk/core/testing'
import { flush } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { ExtensionName } from '@/sdk/solid'
import { SOURCE_HEADER } from '../../../../shared/protocol.ts'
import { FakeSource } from '../../../../test/web/fake-source.ts'
import { expectDistinctAgentNames } from '../../../../test/web/agent-names.ts'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'
import type { Todo } from '../../refs.ts'

const harness = vi.hoisted(() => ({
  sources: [] as FakeSource[],
  actions: [] as { name: string; args: unknown; source: string | null }[],
  submits: [] as { text: string; whenBusy?: string; images?: unknown; source: string | null }[],
}))
vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createStore } = await import('../../../../web/src/sdk/store.ts')
  const { createApi } = await import('../../../../web/src/sdk/api.ts')
  const { createReads } = await import('../../../../web/src/sdk/reads.ts')
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  const { createRegistry } = await import('../../../../web/src/sdk/registry.ts')
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input as string
    const source = new Headers(init?.headers).get(SOURCE_HEADER)
    if (path === '/api/conversations/69/submit') {
      const { text, whenBusy, images } = JSON.parse(init!.body as string) as {
        text: string
        whenBusy?: string
        images?: unknown
      }
      harness.submits.push({ text, whenBusy, images, source })
      return Response.json({ submissionId: 412 })
    }
    if (path === '/api/extensions/inbox/actions/followUpStatus') {
      const { args, conversationId } = JSON.parse(init!.body as string)
      harness.actions.push({ name: 'followUpStatus', args: { ...args, conversationId }, source })
      return Response.json({ result: { status: 'pending' } })
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
    if (!action) return Response.json({ ok: true })
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

import { store } from '../../../../web/src/sdk/client.ts'
import { InboxTodoControls, TodoPane } from '../../inbox.solid.tsx'

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
  renderSolid(() => (
    <ExtensionName value="todos">
      <InboxTodoControls />
      <TodoPane todo={todo(3, 'user', 'Renew the cert')} />
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
  await press('Mark done')
  expect(harness.submits).toEqual([])
  await set('Prompt for @ultimate', 'textarea', 'Which cert store?')
  await press('Send prompt to @ultimate')
  expect(document.querySelector('[data-todo-pane="3"]')?.textContent).toMatch(
    /Sent to.*#69.*Awaiting reply.*Open conversation/,
  )
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
  expect(harness.submits).toEqual([
    {
      text: 'About my to-do #3: Renew the cert\n\nWhich cert store?',
      whenBusy: 'followUp',
      source: 'agent',
    },
  ])
  expect(harness.actions).toContainEqual({
    name: 'followUpStatus',
    args: { submissionId: 412, conversationId: 69 },
    source: 'person',
  })
})
