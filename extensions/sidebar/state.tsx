import type { ConversationId } from '@earendil-works/pi-durable'
import { useStore, useUltimate, useUiState, useViewport } from '@/sdk'
import type { JsonValue } from '@/sdk'

export const useSidebarState = <T extends JsonValue>(
  persistedConversationsKey: string,
  initial: T,
) => useUiState<T>(`ext.conversations.${persistedConversationsKey}`, initial)

export function useShownOnPhone() {
  const phone = useViewport() === 'phone'
  const overlaid = useStore((state) => state.ui.open?.phone?.sidebar ?? false)
  return phone && overlaid
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
