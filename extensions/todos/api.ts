/** To-dos for other extensions: add to the project's list from server code, at most once per key. */
import { defineApi } from '../../shared/extension-api.ts'
import type { AddTodoArgs, Todo } from './refs.ts'

export type TodosService = {
  /**
   * Add a to-do for `owner` with optional `priority` and a `due` date (YYYY-MM-DD). A `key` (at most 200 characters)
   * seen before adds nothing and returns the to-do it added, as it is now or, once dropped from the list, as it was
   * when added; the newest 500 keys are kept.
   */
  add(input: AddTodoArgs): Promise<Todo>
}
/** The project's to-do list; `want` it, to-dos are optional. */
export const TodosApi = defineApi<TodosService>()('todos')
