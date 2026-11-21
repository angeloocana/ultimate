/** @jsxImportSource @solidjs/web */
import { Check, Ellipsis, Pencil, Play, Plus, RotateCcw } from '@lucide/solid'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.solid.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.solid.tsx'
import {
  ROOT,
  api,
  errorMessage,
  events,
  showSurface,
  switchConversation,
  useDocOf,
  writingAs,
} from '@/sdk/solid'
import { StandingAction } from '../subagents/refs.ts'
import { TodoEditor } from './editor.solid.tsx'
import { DoneAction, ReopenAction, TodosDoc } from './refs.ts'
import type { Todo } from './refs.ts'

const dialog = 'max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto p-5 sm:max-w-[28rem]'
const helpLabel = (todo: Todo) =>
  todo.owner === 'user' ? 'Ask @ultimate for help' : 'Have @ultimate work on this'

async function askUltimate(todo: Todo, source: string) {
  const id = await api.action(StandingAction, { name: 'ultimate' })
  writingAs(source, () => events.emit('ultimate:sent', { conversationId: id }))
  await writingAs(source, () =>
    api.submit(
      `${todo.owner === 'user' ? 'Help me with' : 'Work on'} to-do #${todo.id}: ${todo.text}`,
      'followUp',
      id,
    ),
  )
  writingAs(source, () => {
    showSurface('agent')
    switchConversation(id)
  })
}

function useTodoAction() {
  const [failure, setFailure] = createSignal<string>()
  async function run(action: Promise<unknown>) {
    setFailure(undefined)
    try {
      await action
    } catch (error) {
      setFailure(errorMessage(error))
    }
  }
  return { failure, run }
}

export function TodoPane(props: { todo: Todo }) {
  const [edit, setEdit] = createSignal<Todo>()
  const [editing, setEditing] = createSignal(false)
  const { failure, run } = useTodoAction()
  return (
    <div class="grid gap-3" data-todo-pane={props.todo.id}>
      <div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
        <span>Priority: {props.todo.priority ?? 'normal'}</span>
        <Show when={props.todo.due}>{(date) => <time datetime={date()}>Due {date()}</time>}</Show>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button class="min-h-10" onClick={() => run(api.action(DoneAction, { id: props.todo.id }))}>
          <Check aria-hidden="true" /> Mark done
        </Button>
        <Button
          class="min-h-10"
          onClick={() => {
            events.emit('inbox:open', { key: `todo:${props.todo.id}` })
            setEdit(props.todo)
            setEditing(true)
          }}
          variant="outline"
        >
          <Pencil aria-hidden="true" /> Edit
        </Button>
        <Button
          class="min-h-10"
          onClick={(_, details) => run(askUltimate(props.todo, details.source))}
          variant="ghost"
        >
          <Play aria-hidden="true" /> {helpLabel(props.todo)}
        </Button>
      </div>
      <Show when={failure()}>
        <p class="break-words text-sm text-error" role="alert">
          {failure()}
        </p>
      </Show>
      <Dialog open={editing()} onOpenChange={setEditing}>
        <DialogContent class={dialog}>
          <Show when={edit()}>
            {(todo) => <TodoEditor todo={todo()} close={() => setEditing(false)} />}
          </Show>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type Group = 'ultimate' | 'completed'
const groupTitle = (group: Group) =>
  group === 'ultimate' ? '@ultimate’s tasks' : 'Completed to-dos'
type TodoView = 'add' | Group

export function InboxTodoControls() {
  const [view, setView] = createSignal<TodoView>('add')
  const [open, setOpen] = createSignal(false)
  let addButton: HTMLButtonElement | undefined
  let menu: HTMLButtonElement | undefined
  let returnFocus: HTMLButtonElement | undefined
  const close = () => setOpen(false)
  const showGroup = (value: unknown) => {
    if (value !== 'completed' && value !== 'ultimate') return
    returnFocus = menu
    setView(value)
    setOpen(true)
  }
  return (
    <div class="flex shrink-0 items-center gap-0.5">
      <Button
        class="h-9 gap-1 px-2"
        aria-label="Open add to-do form"
        onClick={() => {
          returnFocus = addButton
          setView('add')
          setOpen(true)
        }}
        ref={addButton}
        size="sm"
        variant="ghost"
      >
        <Plus aria-hidden="true" /> <span>Add</span>
      </Button>
      <DropdownMenu modal={false} onAction={showGroup}>
        <DropdownMenuTrigger
          aria-label="Manage to-dos"
          class="grid size-9 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-open:bg-accent"
          ref={menu}
        >
          <Ellipsis aria-hidden="true" class="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem value="ultimate">{groupTitle('ultimate')}</DropdownMenuItem>
          <DropdownMenuItem value="completed">{groupTitle('completed')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open()} onOpenChange={setOpen}>
        <DialogContent class={dialog} finalFocus={() => returnFocus ?? null}>
          <Show
            when={view() === 'add'}
            fallback={<ManagedTodos group={view() === 'ultimate' ? 'ultimate' : 'completed'} />}
          >
            <TodoEditor close={close} />
          </Show>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ManagedTodos(props: { group: Group }) {
  const doc = useDocOf(() => ROOT, TodosDoc)
  const [edit, setEdit] = createSignal<Todo>()
  const { failure, run } = useTodoAction()
  const items = createMemo(() => {
    const all = doc()?.items ?? []
    return props.group === 'completed'
      ? all.filter((todo) => todo.done !== undefined).toSorted((a, b) => b.done! - a.done!)
      : all.filter((todo) => todo.owner === 'ultimate' && todo.done === undefined)
  })
  return (
    <Show
      when={edit()}
      fallback={
        <div class="grid min-w-0 gap-3">
          <DialogTitle>{groupTitle(props.group)}</DialogTitle>
          <Show
            when={items().length}
            fallback={
              <p class="text-sm text-muted-foreground">
                {doc() ? 'Nothing here yet.' : 'Loading to-dos…'}
              </p>
            }
          >
            <ul class="divide-y divide-border/60">
              <For each={items()} keyed={(todo) => todo.id}>
                {(todo) => (
                  <li class="space-y-1.5 py-2" data-managed-todo={todo().id}>
                    <p class="break-words text-sm">{todo().text}</p>
                    <p class="flex flex-wrap gap-x-2 font-mono text-[11px] text-muted-foreground">
                      #{todo().id} · {todo().owner === 'user' ? 'You' : '@ultimate'} ·{' '}
                      {todo().priority ?? 'normal'}
                      <Show when={todo().due}>
                        {(date) => <time datetime={date()}>Due {date()}</time>}
                      </Show>
                    </p>
                    <Show
                      when={todo().done === undefined}
                      fallback={
                        <Button
                          aria-label={`Reopen #${todo().id}: ${todo().text}`}
                          class="min-h-9"
                          onClick={() => run(api.action(ReopenAction, { id: todo().id }))}
                          size="sm"
                          variant="outline"
                        >
                          <RotateCcw aria-hidden="true" /> Reopen
                        </Button>
                      }
                    >
                      <div class="flex flex-wrap gap-1">
                        <Button
                          aria-label={`Mark done #${todo().id}: ${todo().text}`}
                          class="min-h-9"
                          onClick={() => run(api.action(DoneAction, { id: todo().id }))}
                          size="sm"
                          variant="outline"
                        >
                          <Check aria-hidden="true" /> Mark done
                        </Button>
                        <Button
                          aria-label={`Edit #${todo().id}: ${todo().text}`}
                          class="min-h-9"
                          onClick={() => setEdit(todo())}
                          size="sm"
                          variant="ghost"
                        >
                          <Pencil aria-hidden="true" /> Edit
                        </Button>
                        <Button
                          aria-label={`${helpLabel(todo())} #${todo().id}: ${todo().text}`}
                          class="min-h-9"
                          onClick={(_, details) => run(askUltimate(todo(), details.source))}
                          size="sm"
                          variant="ghost"
                        >
                          <Play aria-hidden="true" /> Start
                        </Button>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={failure()}>
            <p class="break-words text-sm text-error" role="alert">
              {failure()}
            </p>
          </Show>
        </div>
      }
    >
      {(todo) => <TodoEditor todo={todo()} close={() => setEdit(undefined)} />}
    </Show>
  )
}
