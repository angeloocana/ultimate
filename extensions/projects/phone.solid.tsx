/** @jsxImportSource @solidjs/web */
import { ArrowLeftRight, ChevronRight } from '@lucide/solid'
import { createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible.solid.tsx'
import { cn } from '@/sdk/solid'
import { ProjectSwatch, RepoLabel } from '../sidebar/ui.solid.tsx'
import { ProjectState, useProjectLink, useVisibleReads } from './list.solid.tsx'
import type { RunningProject } from './refs.ts'

function Choice(props: { project: RunningProject; family: readonly string[] }) {
  const link = useProjectLink(() => props.project)
  return (
    <a
      aria-current={link.here() ? 'page' : undefined}
      aria-label={link.title()}
      class={cn(
        'flex h-11 items-center gap-2.5 rounded-md px-2.5 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        link.here() && 'bg-sidebar-accent',
        link.unreachable() && 'opacity-45',
        link.to().href && 'cursor-pointer active:bg-sidebar-accent/70',
      )}
      data-project={props.project.name}
      href={link.to().href}
      onClick={link.navigate}
      title={link.title()}
    >
      <ProjectSwatch
        class={cn('h-7 w-1 shrink-0 rounded-full', link.pending() && 'animate-pulse-dot')}
        family={props.family}
        folder={props.project.name}
      />
      <span class="flex min-w-0 flex-1 flex-col">
        <span
          class={cn(
            'truncate text-[13px] leading-5',
            link.here() ? 'font-semibold text-foreground' : 'text-foreground/85',
          )}
        >
          {link.name()}
        </span>
        <span class="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4 text-muted-foreground/80">
          <Show when={!link.pending()} fallback={<span class="text-brand">opening…</span>}>
            <Show when={props.project.repo}>
              {(repo) => <RepoLabel class="min-w-0" repo={repo()} />}
            </Show>
            <span class="shrink-0 text-muted-foreground/60">{link.to().reason ?? link.port()}</span>
          </Show>
        </span>
      </span>
      <ProjectState busy={link.busy()} questions={link.questions()} />
    </a>
  )
}

export function PhoneSwitch(props: { shown: boolean }) {
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={props.shown}>
      <Picker expanded={[open, setOpen]} />
    </Show>
  )
}

function Picker(props: { expanded: ReturnType<typeof createSignal<boolean>> }) {
  const open = () => props.expanded[0]()
  const { projects: list } = useVisibleReads(open)
  onSettled(() => {
    void list.refetch()
  })
  const projects = () => list.data() ?? []
  const loading = () => !list.data() && !list.error()
  const failed = () => !list.data() && !!list.error()
  const family = createMemo(() => projects().map((project) => project.name))
  const waiting = createMemo(() =>
    projects().reduce((sum, project) => sum + (project.current ? 0 : (project.questions ?? 0)), 0),
  )
  return (
    <Show when={loading() || failed() || projects().length >= 2}>
      <Collapsible bind={props.expanded} class="mx-2 mt-1.5">
        <CollapsibleTrigger
          class="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md pr-2 pl-2.5 text-left text-[13px] text-foreground/85 outline-none active:bg-sidebar-accent/70 focus-visible:ring-1 focus-visible:ring-ring"
          data-project-switch
        >
          <ArrowLeftRight aria-hidden="true" class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="flex-1">Switch project</span>
          <Show when={waiting() > 0 && !open()}>
            <span class="font-mono text-[10px] text-amber-700 tabular-nums dark:text-amber-300">
              {waiting()} for you
            </span>
          </Show>
          <Show when={!loading()}>
            <span class="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
              {projects().length || ''}
            </span>
          </Show>
          <ChevronRight
            aria-hidden="true"
            class={cn(
              'size-3.5 shrink-0 text-muted-foreground/60 transition-transform',
              open() && 'rotate-90',
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <nav
            aria-label="Projects"
            class="flex animate-fade-in flex-col gap-0.5 pt-0.5 pb-1"
            id="project-switch-list"
          >
            <Show when={loading()}>
              <p class="px-2.5 py-2 font-mono text-[10px] text-muted-foreground">loading…</p>
            </Show>
            <Show when={failed()}>
              <p class="px-2.5 py-2 font-mono text-[10px] text-error">
                Could not list the running projects
              </p>
            </Show>
            <For each={projects()} keyed={(project) => project.url}>
              {(project) => <Choice family={family()} project={project()} />}
            </For>
          </nav>
        </CollapsibleContent>
      </Collapsible>
    </Show>
  )
}
