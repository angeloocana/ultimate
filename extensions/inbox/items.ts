import type { ConversationId } from '@earendil-works/pi-durable'
import { markdownText } from '@/components/markdown/parse.ts'
import { dueStatus } from '../../lib/calendar-day.ts'
import { openQuestion } from '../../lib/message-state.ts'
import type { Message } from '../messages/refs.ts'
import type { InboxItem } from './ui.tsx'

export const SURFACE = 'inbox'
export const SELECTED = 'ext.inbox.selected'
export const WAIT_WARNING_AFTER_MS = 60 * 60_000
export const amber = 'text-amber-700 dark:text-amber-300'

export type Anchor = { key: string; at: number }
export type Selection = (Anchor & { open: boolean }) | null
export type Entry = Anchor &
  ({ message: Message; item?: undefined } | { item: InboxItem; message?: undefined })
type Sender = { conversation?: ConversationId; from?: string }
export type Row = Anchor &
  Sender & {
    tag: string
    title: string
    gist?: string
    more?: number
    message?: number
    priority?: InboxItem['priority']
    due?: ReturnType<typeof dueStatus>
  }
export type Answered = Sender & { id: number; at: number; title: string }

const messageKey = (id: number) => `message:${id}`

export function keyOf(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? messageKey(value) : undefined
  if (typeof value !== 'string' || !value) return undefined
  return /^\d+$/.test(value) ? messageKey(Number(value)) : value
}

export const inboxItems = (
  messages: readonly Message[],
  provided: readonly (readonly InboxItem[])[] = [],
): Entry[] =>
  [
    ...messages
      .filter(openQuestion)
      .toReversed()
      .map((message) => ({
        key: messageKey(message.id),
        at: message.at,
        message,
      })),
    ...provided.flat().map((item) => ({ key: item.key, at: item.at, item })),
  ].toSorted(byAge)

const byAge = (a: Anchor, b: Anchor) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

const dueRank = { overdue: 0, today: 1, later: 2 }
const priorityRank = { high: 0, normal: 1, low: 2 }

export const sortForSurface = (entries: readonly Entry[], today: string): Entry[] =>
  entries.toSorted(
    (a, b) =>
      dueRank[dueStatus(a.item?.due, today) ?? 'later'] -
        dueRank[dueStatus(b.item?.due, today) ?? 'later'] ||
      priorityRank[a.item?.priority ?? 'normal'] - priorityRank[b.item?.priority ?? 'normal'] ||
      byAge(a, b),
  )

export function shown<T extends Anchor>(entries: readonly T[], selected: Selection): T | undefined {
  if (!selected) return entries[0]
  let successor: T | undefined
  let newest: T | undefined
  for (const entry of entries) {
    if (entry.key === selected.key) return entry
    if (byAge(entry, selected) > 0 && (!successor || byAge(entry, successor) < 0)) successor = entry
    if (!newest || byAge(entry, newest) > 0) newest = entry
  }
  return successor ?? newest
}

export const UNLOADED = 0

export function selectionAfterChange(
  entries: readonly Anchor[],
  selected: Selection,
): Selection | undefined {
  if (!selected) return undefined
  const entry = entries.find((candidate) => candidate.key === selected.key)
  if (entry) return entry.at === selected.at ? undefined : { ...selected, at: entry.at }
  const linkStillLoading = selected.at === UNLOADED
  if (linkStillLoading) return undefined
  const successor = shown(entries, selected)
  return successor && { key: successor.key, at: successor.at, open: selected.open }
}

export const previewUrl = (text: string) =>
  /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s)<>\]`*]*)?/.exec(text)?.[0]

export const tagOf = (entry: Entry) =>
  entry.message ? (previewUrl(entry.message.text) ? 'preview' : 'question') : entry.item.tag

const sender = (from: Message['from'] | undefined): Sender =>
  typeof from === 'number' ? { conversation: from } : { from }

export const senderOf = (entry: Entry): Sender =>
  sender(entry.message ? entry.message.from : entry.item.conversation)

export function toRow(entry: Entry, today: string): Row {
  const { key, at, message, item } = entry
  return {
    key,
    at,
    ...senderOf(entry),
    tag: tagOf(entry),
    title: message ? markdownText(message.text, true) : item.title,
    gist: message ? markdownText(message.questions?.[0]?.text ?? '') : item.gist,
    more: Math.max(0, (message?.questions?.length ?? 0) - 1),
    message: message?.id,
    priority: item?.priority,
    due: dueStatus(item?.due, today),
  }
}

export function answeredToday(messages: readonly Message[], now: number): Answered[] {
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  return messages
    .filter((m) => m.to === 'user' && (m.state === 'answered' || m.state === 'dismissed'))
    .flatMap((m) => {
      const reply = messages.find((r) => r.from === 'user' && r.re === m.id)
      return reply && reply.at >= midnight
        ? [
            {
              ...sender(m.from),
              id: m.id,
              at: reply.at,
              title: markdownText(m.text, true),
            },
          ]
        : []
    })
    .toSorted((a, b) => b.at - a.at)
}
