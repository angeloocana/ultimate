import { defineWebExtension, provide } from '@/sdk/solid'
import { ExtensionDetails } from '../manager/ui.solid.tsx'
import { Chip, Details, SignInReturn } from './chip.solid.tsx'

export default defineWebExtension({
  slots: { 'statusline.right': [{ component: Chip, order: -2 }], overlay: [SignInReturn] },
  provides: [provide(ExtensionDetails, Details)],
})
