/** Inbox follow-up receipts: track a sent prompt without leaving the item. */
import { actionRef } from '../../shared/extension-api.ts'

/** Read the status of one admitted follow-up input, scoped to the receiving conversation. */
export const FollowUpStatusAction = actionRef<
  { submissionId: number },
  { status: 'pending' | 'replied' | 'no-reply' }
>('inbox', 'followUpStatus')
