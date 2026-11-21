/** @jsxImportSource @solidjs/web */
import { settle } from '@ui-sdk/core/testing'
import { flush } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { renderSolid } from '../../../../test/web/solid-dom-setup.ts'

vi.mock('../../../../web/src/sdk/client.ts', async () => {
  const { createStore } = await import('../../../../web/src/sdk/store.ts')
  const { createRegistry } = await import('../../../../web/src/sdk/registry.ts')
  const { createUiState } = await import('../../../../web/src/sdk/ui-state.ts')
  return {
    store: createStore(),
    registry: createRegistry(),
    uiState: createUiState(undefined),
    api: {},
  }
})

import { registry } from '../../../../web/src/sdk/client.ts'
import { provide } from '../../../../web/src/sdk/types.ts'
import { InboxItems } from '../../points.ts'
import { InboxSidebar, WaitingBadge } from '../../surface.solid.tsx'

it('shows a failing item provider inline on the Inbox badge and sidebar row', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await registry.setLoaders({
    'extensions/broken/web.solid.tsx': async () => ({
      default: {
        provides: [
          provide(InboxItems, () => () => {
            throw new Error('items broke')
          }),
        ],
      },
    }),
  })
  const container = renderSolid(() => (
    <>
      <div data-part="badge">
        <WaitingBadge />
      </div>
      <div data-part="sidebar">
        <InboxSidebar />
      </div>
    </>
  ))
  flush()
  await settle()
  for (const part of ['badge', 'sidebar'])
    expect(
      container.querySelector(`[data-part="${part}"] [data-extension-error="broken"]`)?.textContent,
    ).toContain('items broke')
})
