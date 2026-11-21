/** Inbox follow-up receipts: track a sent prompt without leaving the item. */
import type { ConversationId } from '@earendil-works/pi-durable'
import { actionRef, docRef } from '../../shared/extension-api.ts'
import type { SubmitRequest } from '../../shared/protocol.ts'

/** The latest input admitted for an Inbox item. */
export type FollowUpReceipt = { to: ConversationId; submissionId: number; at: number }

/** The latest receipt per item, recorded in the same commit as the input on the chapter's root. */
export const FollowUpsDoc = docRef<{ items: Record<string, FollowUpReceipt> }>('inbox.follow-ups')

/** Admit a follow-up to the receiving conversation, and record its receipt for this item. */
export const SubmitFollowUpAction = actionRef<
  { item: string; text: string; images?: SubmitRequest['images'] },
  FollowUpReceipt
>('inbox', 'submitFollowUp')

/** Read the status of one admitted follow-up input, scoped to the receiving conversation. */
export const FollowUpStatusAction = actionRef<
  { submissionId: number },
  { status: 'pending' | 'replied' | 'no-reply' }
>('inbox', 'followUpStatus')
