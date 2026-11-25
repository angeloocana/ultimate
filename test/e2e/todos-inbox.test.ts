import type { ConversationId } from '@earendil-works/pi-durable'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it } from 'vitest'
import { browserBinary } from '../../extensions/browser/server.ts'
import { Started } from '../../extensions/messages/addresses.ts'
import { context } from '../../server/harness.ts'
import { prebuiltServer, post, removeTemp, temp, until } from '../helpers.ts'

it('triages questions and to-dos together on a phone, with agent and completed tasks in the menu', async ({
  onTestFinished,
}) => {
  const home = await temp('ultimate-todos-inbox-')
  onTestFinished(() => removeTemp(home))
  const server = await prebuiltServer({
    userHome: home,
    home: join(home, 'state'),
    port: 0,
  })
  onTestFinished(() => server.close())
  const browser = await chromium.launch({
    executablePath: await browserBinary(),
    headless: true,
    env: { ...process.env, TMPDIR: undefined },
  })
  onTestFinished(() => browser.close())
  server.host.faux!.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('message', {
          to: 'user',
          text: 'Choose a color',
          questions: [{ text: 'Which color?', kind: 'text', ref: '1' }],
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('I will wait.'),
  ])
  const branch = (await post(server, '/api/conversations', {})).data.id as ConversationId
  const parent = (await post(server, '/api/conversations', {})).data.id as ConversationId
  await server.harness.commit(async (tx) => {
    ;(await tx.doc(Started, branch)).by = parent
  }, context)
  const run = await (await server.harness.conversation(branch, context))!.submit(
    { type: 'input', content: 'Ask for a color.' },
    context,
  )
  await run.wait(context)
  await post(server, '/api/extensions/todos/actions/add', {
    args: { text: 'Draft a plan', owner: 'ultimate' },
  })

  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  await page.goto(`${server.url}/?inbox`, { waitUntil: 'domcontentloaded' })
  page.setDefaultTimeout(10_000)
  const rows = page.locator('[data-inbox-row]')
  await rows.filter({ hasText: 'Choose a color' }).waitFor()
  await page.getByRole('button', { name: 'New to-do', exact: true }).tap()
  const add = page.getByRole('dialog', { name: 'Add to-do' })
  const clinic = 'https://example.com/clinic'
  await add.getByRole('textbox', { name: 'To-do text' }).fill(`Call the clinic (${clinic})`)
  await add.getByText('Low', { exact: true }).tap()
  await add.locator('input[type=date]').fill('2000-01-01')
  await add.getByRole('button', { name: 'Create to-do' }).tap()
  await add.waitFor({ state: 'hidden' })
  await rows.filter({ hasText: 'Call the clinic' }).waitFor()
  expect(await rows.count()).toBe(2)
  expect(await rows.first().textContent()).toContain('Overdue')
  await rows.filter({ hasText: 'Call the clinic' }).tap()
  const pane = page.locator('[data-inbox-item]').filter({ hasText: 'Call the clinic' })
  const link = pane.getByRole('link', { name: clinic })
  await page.context().route(clinic, (route) => route.fulfill({ body: 'Clinic' }))
  const opened = page.waitForEvent('popup')
  await link.tap()
  const popup = await opened
  await popup.waitForURL(clinic)
  await popup.close()
  await pane.getByRole('button', { name: 'Edit', exact: true }).tap()
  const edit = page.getByRole('dialog', { name: 'Edit to-do' })
  await edit.getByRole('textbox', { name: 'To-do text' }).fill('Call the doctor')
  await edit.getByRole('button', { name: 'Clear due date' }).tap()
  await edit.getByRole('button', { name: 'Save changes' }).tap()
  await edit.waitFor({ state: 'hidden' })
  const changed = page.locator('[data-inbox-item]').filter({ hasText: 'Call the doctor' })
  await changed.getByRole('button', { name: 'Back to the Inbox' }).tap()
  await until(async () => (await rows.first().textContent())?.includes('Choose a color') ?? false)
  await rows.filter({ hasText: 'Call the doctor' }).tap()
  await changed.getByRole('button', { name: 'Mark done' }).tap()
  await changed.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Back to the Inbox' }).tap()

  const menu = page.getByRole('button', { name: 'Manage to-dos' })
  await menu.tap()
  await page.getByRole('menuitem', { name: '@ultimate’s tasks' }).tap()
  const agentTasks = page.getByRole('dialog', { name: '@ultimate’s tasks' })
  await agentTasks.getByText('Draft a plan').waitFor()
  await agentTasks.getByRole('button', { name: 'Close', exact: true }).tap()
  await agentTasks.waitFor({ state: 'hidden' })
  await menu.tap()
  await page.getByRole('menuitem', { name: 'Completed to-dos' }).tap()
  const completed = page.getByRole('dialog', { name: 'Completed to-dos' })
  await completed.getByRole('button', { name: /Reopen.*Call the doctor/ }).tap()
  await completed.getByText('Nothing here yet.').waitFor()
  await completed.getByRole('button', { name: 'Close', exact: true }).tap()
  await completed.waitFor({ state: 'hidden' })
  await rows.filter({ hasText: 'Call the doctor' }).waitFor()
  expect(await rows.count()).toBe(2)
})
