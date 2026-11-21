/** @jsxImportSource @solidjs/web */
import type { ConversationId } from '@earendil-works/pi-durable'
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  MessageCirclePlus,
} from '@lucide/solid'
import { Match, Show, Switch, createSignal, onSettled } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { PromptComposer } from '@/sdk/parts.solid.tsx'
import {
  ROOT,
  api,
  cn,
  errorMessage,
  events,
  formatAgo,
  showSurface,
  switchConversation,
  useAction,
  useDocOf,
  useNow,
  useStore,
  writerNow,
  writingAs,
} from '@/sdk/solid'
import { ConversationRef } from '../conversations/ui.solid.tsx'
import { withContext } from './items.ts'
import { FollowUpsDoc, FollowUpStatusAction, SubmitFollowUpAction } from './refs.ts'
import type { FollowUpReceipt } from './refs.ts'

const POLL_PENDING_MS = 2000

type Images = { data: string; mimeType: string }[]

function scrollerOf(element: Element) {
  for (let at = element.parentElement; at; at = at.parentElement)
    if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at
  return undefined
}

function openConversation(id: ConversationId, source: string) {
  writingAs(source, () => {
    showSurface('agent')
    switchConversation(id)
  })
}

type FollowUpProps = {
  item: string
  at: number
  label: string
  placeholder: string
  to: () => ConversationId | Promise<ConversationId>
  context: string
  ask?: string
  focus?: boolean
}

export function FollowUp(props: FollowUpProps) {
  const followUps = useDocOf(() => ROOT, FollowUpsDoc)
  const database = useStore((state) => state.system?.persistence.path)
  const [admitted, setAdmitted] = createSignal<{ item: string; receipt: FollowUpReceipt }>()
  const receipt = () => {
    const remote = followUps()?.items[props.item]
    const local = admitted()
    return local?.item === props.item && local.receipt.submissionId >= (remote?.submissionId ?? 0)
      ? local.receipt
      : remote
  }
  const [expanded, setExpanded] = createSignal(false)
  const open = () => !props.ask || expanded()

  const send = async (text: string, images: Images) => {
    const who = writerNow()
    const item = props.item
    const prompt = withContext(props.context, text)
    const to = await props.to()
    const delivered = await writingAs(who, () =>
      api.action(SubmitFollowUpAction, { item, text: prompt, images }, { conversationId: to }),
    )
    setAdmitted({ item, receipt: delivered })
    writingAs(who, () => events.emit('ultimate:sent', { conversationId: to }))
  }

  return (
    <div class="grid min-w-0 gap-2" data-follow-up={props.item}>
      <Show when={receipt()} keyed>
        {(sent) => <SentReceipt receipt={sent} />}
      </Show>
      <Show
        when={open()}
        fallback={
          <Button
            class="min-h-11 justify-start gap-2 px-3"
            onClick={() => setExpanded(true)}
            variant="outline"
          >
            <MessageCirclePlus aria-hidden="true" class="size-4 text-muted-foreground" />
            {props.ask}
          </Button>
        }
      >
        <Show
          when={database()}
          keyed
          fallback={<p class="text-sm text-muted-foreground">Loading follow-up…</p>}
        >
          {(path) => (
            <Composer
              draftKey={`inbox.${path}.${props.item}.${props.at}`}
              focus={!!props.ask || !!props.focus}
              label={props.label}
              onSend={send}
              placeholder={props.placeholder}
            />
          )}
        </Show>
      </Show>
    </div>
  )
}

function Composer(props: {
  focus: boolean
  draftKey: string
  label: string
  placeholder: string
  onSend: (text: string, images: Images) => Promise<void>
}) {
  let wrap: HTMLDivElement | undefined
  onSettled(() => {
    const box = wrap
    const composer = box?.firstElementChild
    if (!box || !composer) return undefined
    const viewport = window.visualViewport
    const listeners = new AbortController()
    let frame = 0
    const visibleBottom = () =>
      viewport ? viewport.offsetTop + viewport.height : window.innerHeight
    const scrollSendIntoView = () => {
      const below = composer.getBoundingClientRect().bottom + 8 - visibleBottom()
      if (below > 0) scrollerOf(box)?.scrollBy({ top: below })
    }
    const keepSendInView = () => {
      cancelAnimationFrame(frame)
      const occluded = Math.max(0, window.innerHeight - visibleBottom())
      if (!occluded) box.style.paddingBottom = ''
      if (!box.contains(document.activeElement)) return
      if (occluded) box.style.paddingBottom = `${occluded}px`
      frame = requestAnimationFrame(scrollSendIntoView)
    }
    const resized = new ResizeObserver(keepSendInView)
    resized.observe(composer)
    viewport?.addEventListener('resize', keepSendInView, { signal: listeners.signal })
    viewport?.addEventListener('scroll', keepSendInView, { signal: listeners.signal })
    box.addEventListener('focusin', keepSendInView, { signal: listeners.signal })
    box.addEventListener('focusout', keepSendInView, { signal: listeners.signal })
    if (props.focus) box.querySelector('textarea')?.focus()
    return () => {
      cancelAnimationFrame(frame)
      resized.disconnect()
      listeners.abort()
    }
  })
  return (
    <div ref={wrap}>
      <PromptComposer
        draftKey={props.draftKey}
        label={props.label}
        onSend={props.onSend}
        placeholder={props.placeholder}
      />
    </div>
  )
}

const showInReceipt = () => undefined

function SentReceipt(props: { receipt: FollowUpReceipt }) {
  const now = useNow(30_000)
  const status = useAction(
    FollowUpStatusAction,
    {
      get submissionId() {
        return props.receipt.submissionId
      },
    },
    {
      get conversation() {
        return props.receipt.to
      },
      every: (data) => (!data || data.status === 'pending' ? POLL_PENDING_MS : undefined),
      onError: showInReceipt,
    },
  )
  const state = () => status.data()?.status
  const failure = () => {
    const error = status.error()
    if (error && state() !== 'replied' && state() !== 'no-reply') return errorMessage(error)
    return undefined
  }
  return (
    <div
      class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/70 bg-card/60 py-1.5 pr-1.5 pl-3 font-mono text-[11px] text-muted-foreground"
      data-follow-up-receipt={props.receipt.submissionId}
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="shrink-0">Sent to</span>
        <ConversationRef class="text-foreground/90" id={props.receipt.to} />
        <time
          class="shrink-0 tabular-nums"
          datetime={new Date(props.receipt.at).toISOString()}
          title={new Date(props.receipt.at).toLocaleString()}
        >
          · {formatAgo(props.receipt.at, now())}
        </time>
      </span>
      <span
        aria-live="polite"
        class={cn(
          'flex min-w-0 items-center gap-1',
          state() === 'replied' && 'text-success',
          failure() && 'text-error',
        )}
      >
        <Switch
          fallback={
            <>
              <CircleDashed
                aria-hidden="true"
                class="size-3 motion-safe:animate-spin [animation-duration:3s]"
              />
              Awaiting reply
            </>
          }
        >
          <Match when={state() === 'replied'}>
            <CircleCheck aria-hidden="true" class="size-3" /> Reply arrived
          </Match>
          <Match when={state() === 'no-reply'}>
            <CircleSlash aria-hidden="true" class="size-3" /> No reply
          </Match>
          <Match when={failure()}>
            <span class="break-words" title={failure()}>
              Couldn’t check reply: {failure()}
            </span>
          </Match>
        </Switch>
      </span>
      <Button
        aria-label={`Open conversation #${props.receipt.to}`}
        class="ml-auto h-8 gap-1 px-2 font-sans text-[12px]"
        onClick={(_, details) => openConversation(props.receipt.to, details.source)}
        size="sm"
        variant="ghost"
      >
        Open conversation <ArrowUpRight aria-hidden="true" class="size-3.5" />
      </Button>
    </div>
  )
}
