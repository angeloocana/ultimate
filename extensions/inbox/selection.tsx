import { useEffect } from 'react'
import { useUiState, writingAs } from '@/sdk'
import { SELECTED, selectionAfterChange, shown } from './items.ts'
import type { Entry, Selection } from './items.ts'

export function useSelection(entries: readonly Entry[], ready: boolean) {
  const [selected, setSelected] = useUiState<Selection>(SELECTED, null)
  useEffect(() => {
    if (!ready) return
    const next = selectionAfterChange(entries, selected)
    if (next) writingAs('app', () => setSelected(next))
  }, [entries, ready, selected, setSelected])
  const item =
    !ready && selected
      ? entries.find((entry) => entry.key === selected.key)
      : shown(entries, selected)
  return { shown: item, selected, setSelected }
}
