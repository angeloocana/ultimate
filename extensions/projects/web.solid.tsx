/** @jsxImportSource @solidjs/web */
import { defineWebExtension, provide } from '@/sdk/solid'
import { ProjectSwitch } from '../sidebar/ui.solid.tsx'
import { OpeningBar } from './list.solid.tsx'
import { PhoneSwitch } from './phone.solid.tsx'
import { Rail } from './rail.solid.tsx'

export default defineWebExtension({
  slots: { 'shell.rail': Rail, overlay: OpeningBar },
  provides: [provide(ProjectSwitch, PhoneSwitch)],
})
