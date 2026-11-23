import { Show, createSignal } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { DialogTitle } from '@/components/ui/dialog.solid.tsx'
import { Form } from '@/components/ui/form.solid.tsx'
import { Input, Textarea } from '@/components/ui/input.solid.tsx'
import { SegmentedControl, SegmentedControlItem } from '@/components/ui/segmented-control.solid.tsx'
import { api, errorMessage } from '@/sdk/solid'
import { AddAction, UpdateAction } from './refs.ts'
import type { Todo, TodoPriority } from './refs.ts'

export function TodoEditor(props: { todo?: Todo; close: () => void }) {
  const [text, setText] = createSignal(() => props.todo?.text ?? '')
  const [owner, setOwner] = createSignal<Todo['owner']>('user')
  const [priority, setPriority] = createSignal<TodoPriority>(() => props.todo?.priority ?? 'normal')
  const [due, setDue] = createSignal(() => props.todo?.due ?? '')
  const [failure, setFailure] = createSignal<string>()

  async function save() {
    const todo = props.todo
    const title = text().trim()
    if (!title) return
    const rank = priority()
    const date = due()
    setFailure(undefined)
    try {
      if (todo) {
        await api.action(UpdateAction, {
          id: todo.id,
          ...(todo.text !== title ? { text: title } : {}),
          ...((todo.priority ?? 'normal') !== rank ? { priority: rank } : {}),
          ...((todo.due ?? '') !== date ? { due: date || null } : {}),
        })
      } else {
        await api.action(AddAction, {
          text: title,
          owner: owner(),
          ...(rank !== 'normal' ? { priority: rank } : {}),
          ...(date ? { due: date } : {}),
        })
      }
    } catch (error) {
      setFailure(errorMessage(error))
      return
    }
    props.close()
  }

  return (
    <Form class="grid min-w-0 gap-4">
      <DialogTitle>{props.todo ? 'Edit to-do' : 'Add to-do'}</DialogTitle>
      <Textarea
        aria-label="To-do text"
        class="min-h-20 text-base sm:text-[14px]"
        maxlength={300}
        onValueChange={setText}
        placeholder="What needs to be done?"
        rows={3}
        submitShortcut="mod+enter"
        value={text()}
      />
      <Show when={!props.todo}>
        <div class="grid gap-1.5">
          <span class="section-label">For</span>
          <SegmentedControl aria-label="To-do owner" bind={[owner, setOwner]} class="w-fit">
            <SegmentedControlItem class="min-h-10 px-3" value="user">
              You
            </SegmentedControlItem>
            <SegmentedControlItem class="min-h-10 px-3" value="ultimate">
              @ultimate
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      </Show>
      <div class="grid gap-1.5">
        <span class="section-label">Priority</span>
        <SegmentedControl aria-label="Priority" bind={[priority, setPriority]} class="w-fit">
          <SegmentedControlItem class="min-h-10 px-3" value="low">
            Low
          </SegmentedControlItem>
          <SegmentedControlItem class="min-h-10 px-3" value="normal">
            Normal
          </SegmentedControlItem>
          <SegmentedControlItem class="min-h-10 px-3" value="high">
            High
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div class="grid min-w-0 gap-1.5">
        <span class="section-label">
          Due date <span class="normal-case">(optional)</span>
        </span>
        <span class="flex min-w-0 items-center gap-2">
          <Input
            aria-label="Due date"
            class="h-10 min-w-0 flex-1 text-base sm:text-sm"
            type="date"
            onValueChange={setDue}
            value={due()}
          />
          <Show when={due()}>
            <Button
              aria-label="Clear due date"
              class="h-10"
              onClick={() => setDue('')}
              variant="ghost"
            >
              Clear
            </Button>
          </Show>
        </span>
      </div>
      <Show when={failure()}>
        <p class="break-words text-sm text-error" role="alert">
          {failure()}
        </p>
      </Show>
      <Button
        class="h-10 justify-self-end px-4"
        disabled={!text().trim()}
        onClick={save}
        type="submit"
      >
        {props.todo ? 'Save changes' : 'Create to-do'}
      </Button>
    </Form>
  )
}
