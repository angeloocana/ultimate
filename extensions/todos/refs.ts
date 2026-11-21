/** To-dos in the browser: the project's short list of open loops, each owned by the user or @ultimate. Browser-safe. */
import { actionRef, docRef } from '../../shared/extension-api.ts'

export type TodoPriority = 'high' | 'normal' | 'low'

/** One to-do. `done` is when it was ticked, epoch ms; absent while it is open. */
export type Todo = {
  id: number
  text: string
  owner: 'user' | 'ultimate'
  /** When it was added, epoch ms. */
  at: number
  done?: number
  /** Absent means normal priority. */
  priority?: TodoPriority
  /** Local calendar date (YYYY-MM-DD), without a time or zone. */
  due?: string
}
/** `{ next, items }` on conversation 1: every open to-do and the last 50 done ones, oldest first. */
export const TodosDoc = docRef<{ next: number; items: Todo[] }>('todos')

export type AddTodoArgs = Pick<Todo, 'text' | 'owner' | 'priority' | 'due'> & { key?: string }
export type UpdateTodoArgs = Pick<Todo, 'id' | 'priority'> & { text?: string; due?: string | null }

/**
 * `{ text, owner, key?, priority?, due? }` → the new to-do, or the one `key` already added. User-only;
 * @ultimate uses its `todo` tool, server code `TodosApi`.
 */
export const AddAction = actionRef<AddTodoArgs, Todo>('todos', 'add')
/** `{ id, text?, priority?, due? }` → the updated to-do. Omit a field to keep it; `due: null` clears it. User-only. */
export const UpdateAction = actionRef<UpdateTodoArgs, Todo>('todos', 'update')
/** `{ id }` → the to-do, ticked. User-only. */
export const DoneAction = actionRef<{ id: number }, Todo>('todos', 'done')
/** `{ id }` → the to-do, open again. User-only. */
export const ReopenAction = actionRef<{ id: number }, Todo>('todos', 'reopen')
