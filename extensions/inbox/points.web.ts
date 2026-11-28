import type { ConversationId } from '@earendil-works/pi-durable'
import type { JSX } from '@solidjs/web'
import { definePoint } from '../../web/src/sdk/types.ts'
import type { Message } from '../messages/refs.ts'

export type InboxItem = {
  key: string
  at: number
  priority?: 'high' | 'normal' | 'low'
  due?: string
  conversation?: ConversationId
  tag: string
  title: string
  heading?: () => JSX.Element
  gist?: string
  pane: () => JSX.Element
}

export const InboxItems = definePoint<null, InboxItem[] | undefined>('inbox.items')
export const QuestionPane = definePoint<
  { message: Message | undefined; phone: boolean; close: () => void },
  (() => JSX.Element) | undefined
>('inbox.question-pane')
