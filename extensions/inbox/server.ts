import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { defineDoc, defineExtension, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { SubmissionId } from '@earendil-works/pi-durable'
import { implementAction } from '../../lib/actions.ts'
import { promptImages } from '../../lib/prompt-images.ts'
import { UserInputEvent } from '../../shared/events.ts'
import { FollowUpsDoc, FollowUpStatusAction, SubmitFollowUpAction } from './refs.ts'
import type { FollowUpReceipt } from './refs.ts'

const FollowUps = defineDoc<{ items: Record<string, FollowUpReceipt> }>({
  kind: FollowUpsDoc.kind,
  version: 1,
  checkpointWhen: () => false,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ items: {} }),
})

export const docs = [FollowUps]
export const userActions = [SubmitFollowUpAction.name]
export const pollActions = [FollowUpStatusAction.name]
export const actions = {
  submitFollowUp: implementAction(
    SubmitFollowUpAction,
    async (args, { host, conversationId, device }) => {
      const { item, text, images } = (args ?? {}) as Record<string, unknown>
      if (typeof item !== 'string' || item.length > 120 || !/^[\w-]+:[\w.-]+$/.test(item))
        throw new Error('Expected an Inbox item key')
      if (typeof text !== 'string') throw new Error('Expected text')
      const blocks = promptImages(images)
      if (!text.trim() && !blocks.length) throw new Error('Expected text or images')
      const content = blocks.length ? [{ type: 'text' as const, text }, ...blocks] : text
      const harness = host.harness()
      const to = conversationId && (await harness.conversation(conversationId, BACKGROUND_CONTEXT))
      if (!to) throw new Error('The receiving conversation is no longer available')
      const receipt = await harness.commit(async (tx) => {
        const followUps = await tx.doc(FollowUps, ROOT_CONVERSATION_ID)
        const submissionId = await to.submit(tx, { type: 'input', content, whenBusy: 'followUp' })
        const admitted = { to: to.id, submissionId, at: Date.now() }
        followUps.items[item] = admitted
        await host.emit(tx, UserInputEvent, {
          conversation: to.id,
          kind: 'follow-up',
          submission: submissionId,
          length: text.length,
          ...device,
        })
        return admitted
      }, BACKGROUND_CONTEXT)
      harness.resume()
      return receipt
    },
  ),
  followUpStatus: implementAction(FollowUpStatusAction, async (args, { host, conversationId }) => {
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
  }),
}

export default defineExtension({ name: 'inbox' })
