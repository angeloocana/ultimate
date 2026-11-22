/** @jsxImportSource @solidjs/web */
/** To-do reading pane contributions for Solid and user extensions. */
import { definePoint } from '@/sdk/solid'

/** Inline references for the opened to-do; the list row and title remain plain text. */
export const TodoReferences = definePoint<{ id: number; text: string }, unknown>('todos.references')
