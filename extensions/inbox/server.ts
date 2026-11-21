import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'
import type { SubmissionId } from '@earendil-works/pi-durable'
import { implementAction } from '../../lib/actions.ts'
import { FollowUpStatusAction } from './refs.ts'

export const pollActions = [FollowUpStatusAction.name]
export const actions = {
  [FollowUpStatusAction.name]: implementAction(
    FollowUpStatusAction,
    async (args, { host, conversationId }) => {
      const id = (args as { submissionId?: unknown } | null)?.submissionId
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
        throw new Error('Expected a submission id')
      const submission = await host
        .harness()
        .commit((tx) => tx.submission(id as SubmissionId), BACKGROUND_CONTEXT)
      if (submission?.type !== 'input' || submission.conversationId !== conversationId)
        throw new Error('Unknown follow-up in this conversation')
      return {
        status:
          submission.status === 'done'
            ? 'replied'
            : submission.status === 'unanswered'
              ? 'no-reply'
              : 'pending',
      } as const
    },
  ),
}

export default defineExtension({ name: 'inbox' })
