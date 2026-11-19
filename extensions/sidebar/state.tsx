import type { ConversationId } from '@earendil-works/pi-durable'
import { useRegionOpen, useUltimate, useUiState, useViewport } from '@/sdk'
import type { JsonValue } from '@/sdk'

export const useSidebarState = <T extends JsonValue>(
  persistedConversationsKey: string,
  initial: T,
) => useUiState<T>(`ext.conversations.${persistedConversationsKey}`, initial)

export function useShownOnPhone() {
  const open = useRegionOpen('sidebar')
  return useViewport() === 'phone' && open
}

export function useShell() {
  const actions = useUltimate()
  return {
    ...actions,
    switchConversation: (id: ConversationId, options?: { replace?: boolean }) => {
      actions.showSurface('agent')
      actions.switchConversation(id, options)
    },
  }
}
