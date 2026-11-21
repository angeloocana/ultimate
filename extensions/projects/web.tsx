import { defineWebExtension, island, provide } from '@/sdk'
import { ProjectSwitch } from '../sidebar/ui.tsx'
import { PhoneSwitch } from './phone.solid.tsx'
import { OpeningBar } from './list.solid.tsx'
import { Rail } from './rail.solid.tsx'

export default defineWebExtension({
  slots: { 'shell.rail': island(Rail), overlay: island(OpeningBar) },
  provides: [provide(ProjectSwitch, island(PhoneSwitch))],
})
