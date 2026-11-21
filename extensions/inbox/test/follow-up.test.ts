import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { expect, it } from 'vitest'
import type { ActionContext } from '../../../server/actions.ts'
import { prepareHarness } from '../../../server/harness.ts'
import { temp } from '../../../test/helpers.ts'
import { actions } from '../server.ts'

it('tracks the specific follow-up, not the destination’s other replies', async () => {
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
    const status = (submissionId: number) =>
      actions.followUpStatus({ submissionId }, {
        host: { harness: () => harness },
        conversationId: root.id,
      } as ActionContext)
    const previous = await root.submit({ type: 'input', content: 'Previous prompt' }, context)
    await previous.wait(context)
    harness.hold()
    try {
      const followUp = await root.submit(
        { type: 'input', content: 'About the to-do', whenBusy: 'followUp' },
        context,
      )
      const cancelled = await root.submit(
        { type: 'input', content: 'Do not send this', whenBusy: 'followUp' },
        context,
      )
      expect(await status(previous.id)).toEqual({ status: 'replied' })
      expect(await status(followUp.id)).toEqual({ status: 'pending' })
      expect(await cancelled.abort(context)).toBe('aborted')
      expect(await status(cancelled.id)).toEqual({ status: 'no-reply' })
      harness.release()
      await followUp.wait(context)
      expect(await status(followUp.id)).toEqual({ status: 'replied' })
    } finally {
      harness.release()
    }
  } finally {
    await harness.close(context)
  }
})
