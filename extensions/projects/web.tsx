import { defineWebExtension, island, provide, useViewport } from '@/sdk'
import { ProjectSwitch } from '../sidebar/ui.tsx'
import { PhoneSwitch } from './phone.solid.tsx'
import { OpeningBar } from './list.solid.tsx'
import { Rail } from './rail.solid.tsx'

const PhoneSwitchIsland = island(PhoneSwitch)

function useProjectSwitch(shown: boolean) {
  return useViewport() === 'phone' ? <PhoneSwitchIsland shown={shown} /> : null
}

export default defineWebExtension({
  slots: { 'shell.rail': island(Rail), overlay: island(OpeningBar) },
  provides: [provide(ProjectSwitch, useProjectSwitch)],
})
