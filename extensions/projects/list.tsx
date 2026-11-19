import { deadline, every } from '../../lib/timers.ts'
import type { Cancel } from '../../lib/timers.ts'
import { useEffect, useSyncExternalStore } from 'react'
import type { MouseEvent } from 'react'
import { keepLast, prettyName, useAction } from '@/sdk'
import { destination, shownPort } from './links.ts'
import { ListAction } from './refs.ts'
import type { RunningProject } from './refs.ts'

const VISIBLE_PROJECTS_POLL_MS = 4_000
const NAVIGATION_EXPIRY_MS = 15_000

let pendingNavigation: string | undefined
let cancelNavigationExpiry: Cancel | undefined
const listeners = new Set<() => void>()
const setOpening = (url: string | undefined) => {
  pendingNavigation = url
  cancelNavigationExpiry?.()
  if (url) cancelNavigationExpiry = deadline(NAVIGATION_EXPIRY_MS, () => setOpening(undefined))
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const useOpening = () => useSyncExternalStore(subscribe, () => pendingNavigation)
if (typeof window !== 'undefined') window.addEventListener('pageshow', () => setOpening(undefined))

export function OpeningBar() {
  if (!useOpening()) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 animate-sweep bg-brand/30 bg-size-[300%_100%] bg-no-repeat bg-[linear-gradient(90deg,transparent_30%,var(--color-brand)_50%,transparent_70%)]"
    />
  )
}

export function useVisiblePoll(refetch: () => Promise<unknown>, interval: number, off = false) {
  useEffect(() => {
    if (off) return undefined
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      void refetch()
    }
    const stopPolling = every(interval, visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refetch, interval, off])
}

export function useProjects({ enabled, polling }: { enabled: boolean; polling: boolean }) {
  const list = useAction(ListAction, null, { onError: keepLast, enabled })
  useVisiblePoll(list.refetch, VISIBLE_PROJECTS_POLL_MS, !enabled || !polling)
  const projects = list.data ?? []
  return {
    projects,
    loading: !list.data && !list.error,
    failed: !list.data && list.error !== undefined,
    refetch: list.refetch,
    family: projects.map((project) => project.name),
    questions: projects.reduce((sum, project) => sum + (project.questions ?? 0), 0),
    working: projects.filter((project) => (project.busy ?? 0) > 0).length,
  }
}

export function useProjectLink(project: RunningProject) {
  const pending = useOpening() === project.url
  const busy = (project.busy ?? 0) > 0
  const questions = project.questions ?? 0
  const name = prettyName(project.name)
  const to = destination(project, location)
  const here = project.current
  const unreachable = !here && !to.href
  const title = [
    name,
    project.repo?.name,
    shownPort(project, location),
    unreachable && to.reason,
    questions && `${questions} for you`,
    busy && 'working',
    here && to.reason,
    pending && 'opening',
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    name,
    here,
    unreachable,
    reason: to.reason,
    pending,
    busy,
    questions,
    title,
    anchor: {
      'aria-current': here ? ('page' as const) : undefined,
      'aria-label': title,
      'data-project': project.name,
      href: to.href,
      title,
      onClick: (event: MouseEvent) => {
        const skipsTabNavigation =
          !to.href ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        if (skipsTabNavigation) return
        setOpening(project.url)
      },
    },
  }
}

export function State({ busy, questions }: { busy: boolean; questions: number }) {
  if (questions > 0)
    return (
      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 px-1.5 font-mono text-[10px] font-semibold text-amber-700 tabular-nums ring-1 ring-amber-500/30 ring-inset dark:text-amber-300">
        {questions}
      </span>
    )
  if (busy) return <span className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-brand" />
  return null
}
