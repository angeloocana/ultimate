import { int, obj, opt, str } from '@earendil-works/pi-schema'
import { strEnum } from '../../lib/schema.ts'
import {
  defineDoc,
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  ROOT_CONVERSATION_ID,
} from '@earendil-works/pi-durable'
import type { ConversationId, Tx } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { actingAs } from '../../lib/acting-as.ts'
import { implementAction } from '../../lib/actions.ts'
import { dueStatus, isCalendarDay, localDay } from '../../lib/calendar-day.ts'
import type { ExtensionHost } from '../../server/extensions.ts'
import { Standing } from '../subagents/api.ts'
import { TodosApi } from './api.ts'
import { AddAction, DoneAction, ReopenAction, TodosDoc, UpdateAction } from './refs.ts'
import type { AddTodoArgs, Todo, TodoPriority, UpdateTodoArgs } from './refs.ts'

export const DONE_LIMIT = 50
const TEXT_CHARS = 300
export const KEY_LIMIT = 500
const KEY_CHARS = 200

export const Todos = defineDoc<{ next: number; items: Todo[] }>({
  kind: TodosDoc.kind,
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ next: 1, items: [] }),
})
const LastOpenListCommittedWithInput = defineDoc<{ key?: string }>({
  kind: 'todos.seen',
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({}),
})
const OldestFirstIdempotencyReceipts = defineDoc<{ keys: { key: string; todo: Todo }[] }>({
  kind: 'todos.keys',
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ keys: [] }),
})
export const docs = [Todos, OldestFirstIdempotencyReceipts]

const OWNERS = ['user', 'ultimate'] as const
const PRIORITIES = ['high', 'normal', 'low'] as const satisfies readonly TodoPriority[]

type Untrusted<Args> = { [K in keyof Args]?: unknown }

function validText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error('text must be nonempty')
  if (text.length > TEXT_CHARS) throw new Error(`text must be at most ${TEXT_CHARS} characters`)
  return text
}

function validPriority(value: unknown) {
  if (value === undefined) return undefined
  const priority = PRIORITIES.find((candidate) => candidate === value)
  if (!priority) throw new Error(`priority must be ${PRIORITIES.join(', ')}`)
  return priority
}

function validDue(value: unknown) {
  if (value === undefined) return undefined
  if (!isCalendarDay(value)) throw new Error('due must be a calendar date (YYYY-MM-DD)')
  return value
}

export async function add(tx: Tx, input: Untrusted<AddTodoArgs>): Promise<Todo> {
  const { key } = input
  if (key != null && (typeof key !== 'string' || !key || key.length > KEY_CHARS))
    throw new Error(`key must be a nonempty string of at most ${KEY_CHARS} characters`)
  const receipts =
    typeof key === 'string'
      ? await tx.doc(OldestFirstIdempotencyReceipts, ROOT_CONVERSATION_ID)
      : undefined
  const known = receipts?.keys.find((record) => record.key === key)
  if (known) {
    const current = (await tx.doc(Todos, ROOT_CONVERSATION_ID)).items.find(
      (item) => item.id === known.todo.id,
    )
    return copyTodoBeyondTransaction(current ?? known.todo)
  }
  const text = validText(input.text)
  const owner = OWNERS.find((candidate) => candidate === input.owner)
  if (!owner) throw new Error("owner must be 'user' or 'ultimate'")
  const priority = validPriority(input.priority)
  const due = validDue(input.due)
  const todos = await tx.doc(Todos, ROOT_CONVERSATION_ID)
  const todo: Todo = {
    id: todos.next++,
    text,
    owner,
    at: Date.now(),
    ...(priority === undefined ? {} : { priority }),
    ...(due === undefined ? {} : { due }),
  }
  todos.items.push(todo)
  if (receipts && typeof key === 'string') {
    receipts.keys.push({ key, todo: copyTodoBeyondTransaction(todo) })
    receipts.keys.splice(0, receipts.keys.length - KEY_LIMIT)
  }
  return copyTodoBeyondTransaction(todo)
}

const copyTodoBeyondTransaction = (todo: Todo): Todo => ({ ...todo })

async function update(tx: Tx, input: Untrusted<UpdateTodoArgs>) {
  const todo = (await tx.doc(Todos, ROOT_CONVERSATION_ID)).items.find(
    (item) => item.id === input.id,
  )
  if (!todo) throw new Error(`No to-do ${String(input.id)}`)
  const text = input.text === undefined ? undefined : validText(input.text)
  const priority = validPriority(input.priority)
  const due = input.due === null ? undefined : validDue(input.due)
  if (text !== undefined) todo.text = text
  if (priority !== undefined) todo.priority = priority
  if (due !== undefined) todo.due = due
  else if (input.due === null) delete todo.due
  return copyTodoBeyondTransaction(todo)
}

export async function mark(tx: Tx, id: unknown, done: boolean) {
  const todos = await tx.doc(Todos, ROOT_CONVERSATION_ID)
  const todo = todos.items.find((item) => item.id === id)
  if (!todo) throw new Error(`No to-do ${String(id)}`)
  if (done) {
    todo.done ??= Date.now()
    const ticked = todos.items.filter((item) => item.done !== undefined)
    const olderCompletedTodoIds = new Set(
      ticked
        .toSorted((a, b) => b.done! - a.done!)
        .slice(DONE_LIMIT)
        .map((item) => item.id),
    )
    todos.items = todos.items.filter((item) => !olderCompletedTodoIds.has(item.id))
  } else delete todo.done
  return copyTodoBeyondTransaction(todo)
}

function metadata(todo: Todo, today: string) {
  const fields = []
  if (todo.priority !== undefined) fields.push(`priority: ${todo.priority}`)
  if (todo.due !== undefined) {
    const status = dueStatus(todo.due, today)
    fields.push(`due: ${todo.due}${status ? ` (${status})` : ''}`)
  }
  return fields.length ? ` [${fields.join(', ')}]` : ''
}

export function listText(items: readonly Todo[], today: string) {
  const open = items.filter((item) => item.done === undefined)
  if (!open.length) return undefined
  const mine = open.filter((item) => item.owner === 'ultimate')
  const theirs = open.filter((item) => item.owner === 'user')
  const line = (todo: Todo) => `- ${todo.id}${metadata(todo, today)}: ${todo.text}`
  return [
    ...(mine.length ? ['Yours:', ...mine.map(line)] : []),
    ...(theirs.length ? ["The user's:", ...theirs.map(line)] : []),
  ].join('\n')
}

export async function noteFor(tx: Tx, conversationId: ConversationId, now: number) {
  const items = (await tx.doc(Todos, ROOT_CONVERSATION_ID)).items
  const text = listText(items, localDay(now))
  const key = text ?? ''
  const seen = await tx.doc(LastOpenListCommittedWithInput, conversationId)
  if ((seen.key ?? '') === key) return undefined
  seen.key = key
  return {
    entries: [
      {
        kind: 'todos.note',
        data: { open: items.filter((item) => item.done === undefined).length },
        model: [
          {
            role: 'user' as const,
            content: text
              ? `Open to-dos (todo tool: done when finished):\n${text}`
              : 'No to-dos are open.',
            timestamp: now,
          },
        ],
      },
    ],
  }
}

const fields = <Args extends object>(
  args: Args | string | number | boolean | unknown[] | null,
): Args | undefined => (args && typeof args === 'object' && !Array.isArray(args) ? args : undefined)

export const userActions = ['add', 'update', 'done', 'reopen']
export const actions = {
  add: implementAction(AddAction, (args, { host }) =>
    host.harness().commit((tx) => add(tx, fields(args) ?? {}), context),
  ),
  update: implementAction(UpdateAction, (args, { host }) =>
    host.harness().commit((tx) => update(tx, fields(args) ?? {}), context),
  ),
  done: implementAction(DoneAction, (args, { host }) =>
    host.harness().commit((tx) => mark(tx, fields(args)?.id, true), context),
  ),
  reopen: implementAction(ReopenAction, (args, { host }) =>
    host.harness().commit((tx) => mark(tx, fields(args)?.id, false), context),
  ),
}

const callerIsUltimate = (tx: Tx, id: ConversationId) =>
  tx.doc(Standing, ROOT_CONVERSATION_ID).then((doc) => doc.ultimate === id)

export default function todosExtension(host: ExtensionHost) {
  host.implement(TodosApi, {
    add: (input) => host.harness().commit((tx) => add(tx, input), context),
  })
  return defineExtension({
    name: 'todos',
    hooks: [
      hook(GenerationTask, {
        // Pi upstream: @earendil-works/pi-durable@1.6.0 — patched transactional beforeInput hook.
        beforeInput: async function cachePreservingInputNote(_input, { tx, conversationId }) {
          return (await callerIsUltimate(tx, conversationId))
            ? noteFor(tx, conversationId, Date.now())
            : undefined
        },
      }),
    ],
    tools: [
      defineTool({
        name: 'todo',
        deferred: true,
        description:
          "The project's to-dos, owned by you ('ultimate') or the user ('user'): add {text, owner, priority?, due?}, done {id}, list. Use priority 'high', 'normal' or 'low' and a local calendar due date (YYYY-MM-DD). The user manages to-dos in the Inbox; never add one for a question, which already appears there. Keep open loops here, not in codemode store. Other projects read this list with ultimate.doc('todos', 1, {project}) and ask you to add through ultimate.tell.",
        parameters: obj({
          action: strEnum(['add', 'done', 'list']),
          text: opt(str()),
          owner: opt(strEnum(OWNERS)),
          priority: opt(strEnum(PRIORITIES)),
          due: opt(str({ description: 'Local calendar date (YYYY-MM-DD)' })),
          id: opt(int({ minimum: 1 })),
        }),
        execute: async function executeOnceWithoutReplay(args, api, ctx) {
          const callerIncludingSideChatOwner = await actingAs(host, api.conversationId, ctx)
          const result = await api.commit(async (tx) => {
            if (!(await callerIsUltimate(tx, callerIncludingSideChatOwner)))
              throw new Error(
                'Only @ultimate keeps the to-dos; ask @ultimate to add one (message, reply: false).',
              )
            const today = localDay(Date.now())
            if (args.action === 'add') {
              const { text, owner, priority, due } = args
              const todo = await add(tx, { text, owner, priority, due })
              return `Added ${todo.id} for ${todo.owner}${metadata(todo, today)}: ${todo.text}`
            }
            if (args.action === 'done') {
              const todo = await mark(tx, args.id, true)
              return `Done ${todo.id}: ${todo.text}`
            }
            return (
              listText((await tx.doc(Todos, ROOT_CONVERSATION_ID)).items, today) ??
              'No open to-dos.'
            )
          }, ctx)
          return { output: [{ type: 'text', text: result }] }
        },
      }),
    ],
  })
}
