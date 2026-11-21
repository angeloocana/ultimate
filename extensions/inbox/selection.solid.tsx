/** @jsxImportSource @solidjs/web */
import { createEffect, createMemo } from 'solid-js'
import type { Accessor } from 'solid-js'
import { useUiState, writingAs } from '@/sdk/solid'
import { SELECTED, selectionAfterChange, shown } from './items.ts'
import type { Entry, Selection } from './items.ts'

export function useSelection(entries: Accessor<readonly Entry[]>, ready: Accessor<boolean>) {
  const [selected, setSelected] = useUiState<Selection>(SELECTED, null)
  createEffect(
    () => (ready() ? selectionAfterChange(entries(), selected()) : undefined),
    (next) => {
      if (next) writingAs('app', () => setSelected(next))
    },
  )
  const item = createMemo(() => {
    const selection = selected()
    return !ready() && selection
      ? entries().find((entry) => entry.key === selection.key)
      : shown(entries(), selection)
  })
  return { item, selected, setSelected }
}
