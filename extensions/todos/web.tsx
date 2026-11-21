import { ROOT, defineWebExtension, island, provide, useDocOf, useUltimate } from '@/sdk'
import { InboxItems } from '../inbox/ui.tsx'
import type { InboxItem } from '../inbox/ui.tsx'
import { TodoCall } from './call.solid.tsx'
import { InboxTodoControls, TodoPane } from './inbox.solid.tsx'
import { ModelOnlyTodoReminder } from './note.solid.tsx'
import { TodosDoc } from './refs.ts'

const Controls = island(InboxTodoControls)
const Pane = island(TodoPane)

function TodoControls() {
  return useUltimate().surface === 'inbox' ? <Controls /> : null
}

function useTodoItems(): InboxItem[] | undefined {
  const doc = useDocOf(ROOT, TodosDoc)
  return doc?.items
    .filter((todo) => todo.owner === 'user' && todo.done === undefined)
    .map((todo) => ({
      key: `todo:${todo.id}`,
      at: todo.at,
      tag: 'to-do',
      title: todo.text,
      priority: todo.priority,
      due: todo.due,
      pane: <Pane todo={todo} />,
    }))
}

export default defineWebExtension({
  slots: { 'header.right': [TodoControls] },
  tools: { todo: island(TodoCall) },
  entries: { 'todos.note': island(ModelOnlyTodoReminder) },
  provides: [provide(InboxItems, useTodoItems)],
})
