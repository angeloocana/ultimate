import { createMemo, Show } from 'solid-js'
import { ROOT, defineWebExtension, provide, useDocOf, useSurface } from '@/sdk/solid'
import { InboxItems } from '../inbox/ui.solid.tsx'
import type { InboxItem } from '../inbox/ui.solid.tsx'
import { TodoCall } from './call.solid.tsx'
import { InboxTodoControls, TodoPane, TodoText } from './inbox.solid.tsx'
import { ModelOnlyTodoReminder } from './note.solid.tsx'
import { TodosDoc } from './refs.ts'

function TodoControls() {
  const surface = useSurface()
  return (
    <Show when={surface() === 'inbox'}>
      <InboxTodoControls />
    </Show>
  )
}

function useTodoItems() {
  const doc = useDocOf(() => ROOT, TodosDoc)
  return createMemo((): InboxItem[] | undefined =>
    doc()
      ?.items.filter((todo) => todo.owner === 'user' && todo.done === undefined)
      .map((todo) => ({
        key: `todo:${todo.id}`,
        at: todo.at,
        tag: 'to-do',
        title: todo.text,
        heading: () => <TodoText text={todo.text} />,
        priority: todo.priority,
        due: todo.due,
        pane: () => <TodoPane todo={todo} />,
      })),
  )
}

export default defineWebExtension({
  slots: { 'header.right': [TodoControls] },
  tools: { todo: TodoCall },
  entries: { 'todos.note': ModelOnlyTodoReminder },
  provides: [provide(InboxItems, useTodoItems)],
})
