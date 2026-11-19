import { ArrowLeftRightIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/sdk'
import { ProjectSwatch, RepoLabel } from '../sidebar/ui.tsx'
import { shownPort } from './links.ts'
import { State, useProjectLink, useProjects } from './list.tsx'
import type { RunningProject } from './refs.ts'

function Choice({ project, family }: { project: RunningProject; family: readonly string[] }) {
  const { name, here, unreachable, reason, pending, busy, questions, anchor } =
    useProjectLink(project)
  return (
    <a
      {...anchor}
      className={cn(
        'flex h-11 items-center gap-2.5 rounded-md pr-2.5 pl-2.5 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        here && 'bg-sidebar-accent',
        unreachable && 'opacity-45',
        !here && !unreachable && 'cursor-pointer active:bg-sidebar-accent/70',
      )}
    >
      <ProjectSwatch
        className={cn('h-7 w-1 shrink-0 rounded-full', pending && 'animate-pulse-dot')}
        family={family}
        folder={project.name}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-[13px] leading-5',
            here ? 'font-semibold text-foreground' : 'text-foreground/85',
          )}
        >
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4 text-muted-foreground/80">
          {pending ? (
            <span className="text-brand">opening…</span>
          ) : (
            <>
              {project.repo && <RepoLabel className="min-w-0" repo={project.repo} />}
              <span className="shrink-0 text-muted-foreground/60">
                {reason ?? shownPort(project, location)}
              </span>
            </>
          )}
        </span>
      </span>
      <State busy={busy} questions={questions} />
    </a>
  )
}

export function PhoneSwitch() {
  const [open, setOpen] = useState(false)
  const { projects, loading, failed, family } = useProjects({
    enabled: true,
    polling: open,
  })
  if (!loading && !failed && projects.length < 2) return null
  const waiting = projects
    .filter((project) => !project.current)
    .reduce((sum, project) => sum + (project.questions ?? 0), 0)
  return (
    <div className="mx-2 mt-1.5">
      <button
        aria-controls="project-switch-list"
        aria-expanded={open}
        className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md pr-2 pl-2.5 text-left text-[13px] text-foreground/85 outline-none active:bg-sidebar-accent/70 focus-visible:ring-1 focus-visible:ring-ring"
        data-project-switch
        onClick={() => setOpen(!open)}
        type="button"
      >
        <ArrowLeftRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1">Switch project</span>
        {waiting > 0 && !open && (
          <span className="font-mono text-[10px] text-amber-700 tabular-nums dark:text-amber-300">
            {waiting} for you
          </span>
        )}
        {!loading && (
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
            {projects.length || ''}
          </span>
        )}
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground/60 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <nav
          aria-label="Projects"
          className="flex animate-fade-in flex-col gap-0.5 pt-0.5 pb-1"
          id="project-switch-list"
        >
          {loading && (
            <p className="px-2.5 py-2 font-mono text-[10px] text-muted-foreground">loading…</p>
          )}
          {failed && (
            <p className="px-2.5 py-2 font-mono text-[10px] text-error">
              Could not list the running projects
            </p>
          )}
          {projects.map((project) => (
            <Choice family={family} key={project.url} project={project} />
          ))}
        </nav>
      )}
    </div>
  )
}
