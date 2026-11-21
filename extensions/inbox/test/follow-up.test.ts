import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import type { SubmissionId } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'
import type { ActionContext } from '../../../server/actions.ts'
import { emit } from '../../../server/events.ts'
import { prepareHarness } from '../../../server/harness.ts'
import { temp } from '../../../test/helpers.ts'
import { actions, docs } from '../server.ts'

it('keeps receipts for independent sends and tracks each input through settlement', async () => {
  const home = await temp()
  const prepared = await prepareHarness({
    ultimateRoot: home,
    userHome: home,
    home,
    faux: fauxProvider(),
  })
  prepared.faux!.setResponses([
    fauxAssistantMessage('First answer'),
    fauxAssistantMessage('Follow-up answer'),
  ])
  const { root, harness } = await prepared.open()
  try {
    const actionContext = {
      host: { harness: () => harness, emit },
      conversationId: root.id,
    } as ActionContext
    const status = (submissionId: number) => actions.followUpStatus({ submissionId }, actionContext)
    const send = (item: string, text: string) =>
      actions.submitFollowUp({ item, text }, actionContext)
    const input = async (id: number) => (await harness.submission(id as SubmissionId, context))!
    const previous = await root.submit({ type: 'input', content: 'Previous prompt' }, context)
    await previous.wait(context)
    harness.hold()
    try {
      const [followUp, cancelled] = await Promise.all([
        send('todo:1', 'About the to-do'),
        send('message:1', 'About the question'),
      ])
      expect(await harness.snapshot(docs[0], root.id, context)).toEqual({
        items: { 'todo:1': followUp, 'message:1': cancelled },
      })
      expect(await status(previous.id)).toEqual({ status: 'replied' })
      expect(await status(followUp.submissionId)).toEqual({ status: 'pending' })
      expect(await (await input(cancelled.submissionId)).abort(context)).toBe('aborted')
      expect(await status(cancelled.submissionId)).toEqual({ status: 'no-reply' })
      harness.release()
      await (await input(followUp.submissionId)).wait(context)
      expect(await status(followUp.submissionId)).toEqual({ status: 'replied' })
    } finally {
      harness.release()
    }
  } finally {
    await harness.close(context)
  }
})
