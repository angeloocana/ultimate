import { createMemo, createRoot, createSignal, onSettled, Show } from 'solid-js'
import { ROOT, keepLast, prettyName, useAction, usePageVisible } from '@/sdk/solid'
import { deadline } from '../../lib/timers.shared.ts'
import { destination, shownPort } from './links.web.ts'
import { ListAction } from './refs.ts'
import type { RunningProject } from './refs.ts'

const VISIBLE_PROJECTS_POLL_MS = 4_000
const NAVIGATION_EXPIRY_MS = 15_000

const [opening, setOpening] = createRoot(() => createSignal<string>())
let cancelOpening: (() => void) | undefined
const open = (url: string | undefined) => {
  cancelOpening?.()
  setOpening(url)
  if (url) cancelOpening = deadline(NAVIGATION_EXPIRY_MS, () => setOpening())
}

export function OpeningBar() {
  onSettled(() => {
    const clear = () => open(undefined)
    window.addEventListener('pageshow', clear)
    return () => window.removeEventListener('pageshow', clear)
  })
  return (
    <Show when={opening()}>
      <div
        aria-hidden="true"
        class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 animate-sweep bg-brand/30 bg-size-[300%_100%] bg-no-repeat bg-[linear-gradient(90deg,transparent_30%,var(--color-brand)_50%,transparent_70%)]"
      />
    </Show>
  )
}

export function useVisibleReads(active: () => boolean = () => true) {
  const visible = usePageVisible()
  const polling = createMemo(() => active() && visible())
  const showCount = createMemo<number>((previous) => (previous ?? 0) + Number(polling()))
  const whileVisible = (ms: number) => () => (polling() ? ms : undefined)
  const projects = useAction(ListAction, null, {
    conversation: ROOT,
    on: showCount,
    onError: keepLast,
    every: whileVisible(VISIBLE_PROJECTS_POLL_MS),
  })
  return { projects, showCount, whileVisible }
}

export function useProjectLink(project: () => RunningProject) {
  const name = () => prettyName(project().name)
  const pending = () => opening() === project().url
  const busy = () => (project().busy ?? 0) > 0
  const questions = () => project().questions ?? 0
  const here = () => project().current
  const to = createMemo(() => destination(project(), location))
  const unreachable = () => !here() && !to().href
  const port = () => shownPort(project(), location)
  const title = createMemo(() =>
    [
      name(),
      project().repo?.name,
      port(),
      unreachable() && to().reason,
      questions() && `${questions()} for you`,
      busy() && 'working',
      here() && to().reason,
      pending() && 'opening',
    ]
      .filter(Boolean)
      .join(' · '),
  )
  const navigate = (event: MouseEvent) => {
    if (
      to().href &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    )
      open(project().url)
  }
  return { name, pending, busy, questions, here, to, unreachable, port, title, navigate }
}

export function ProjectState(props: { busy: boolean; questions: number }) {
  return (
    <Show
      when={props.questions > 0}
      fallback={
        <Show when={props.busy}>
          <span class="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-brand" />
        </Show>
      }
    >
      <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 px-1.5 font-mono text-[10px] font-semibold text-amber-700 tabular-nums ring-1 ring-amber-500/30 ring-inset dark:text-amber-300">
        {props.questions}
      </span>
    </Show>
  )
}
