import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { createRegistry, Harness, LiveDoc, MemoryStorage } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'
import { admitCompaction } from '../lib/compaction.ts'

it('records the admitted compaction task on LiveDoc.compactions', async () => {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context,
  )
  try {
    const root = await harness.root(context)
    const taskId = await harness.commit((tx) => admitCompaction(tx, root.id), context)
    const live = await harness.snapshot(LiveDoc, root.id, context)
    expect(live?.compactions).toEqual([{ taskId, trigger: 'manual', blocking: false, attempt: 1 }])
  } finally {
    await harness.close(context)
  }
})
