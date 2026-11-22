// The phone sidebar keeps its children mounted once it opened, so the project picker once kept the list it read on
// first open (a lone project hid it for good) and kept polling every 4 s after the sidebar closed with it unfolded.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { afterEach, expect, it } from 'vitest'
import { browserBinary } from '../../../browser/server.ts'
import type { ReadSubscription, SubscriptionsRequest } from '../../../../shared/protocol.ts'
import { prebuiltServer, removeTemp, temp } from '../../../../test/helpers.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close()
})

async function setup() {
  const userHome = await temp('ultimate-phone-switch-')
  cleanup.push(() => removeTemp(userHome))
  const server = await prebuiltServer({
    userHome,
    home: join(userHome, '.ultimate/projects/here'),
    port: 0,
  })
  cleanup.push(() => server.close())
  const other = join(userHome, '.ultimate/projects/other')
  const startOther = async () => {
    await mkdir(other, { recursive: true })
    await writeFile(
      join(other, 'project.json'),
      JSON.stringify({ root: '/work/other', name: 'other' }),
    )
    await writeFile(join(other, 'ultimate.lock'), JSON.stringify({ pid: process.pid, port: 9 }))
  }
  const browser = await chromium.launch({
    executablePath: await browserBinary(),
    headless: true,
    env: { ...process.env, TMPDIR: undefined },
  })
  cleanup.push(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  await page.goto(`${server.url}/?conversation=1`)
  await page.locator('button[aria-label="Toggle sidebar"]').waitFor()
  return { page, startOther }
}

async function subscriptionChange(page: Page, matches: (change: SubscriptionsRequest) => boolean) {
  const response = await page.waitForResponse((answer) => {
    const request = answer.request()
    if (request.method() !== 'POST' || !new URL(request.url()).pathname.startsWith('/api/events/'))
      return false
    return matches(request.postDataJSON() as SubscriptionsRequest)
  })
  expect(response.ok()).toBe(true)
  return response.request().postDataJSON() as SubscriptionsRequest
}

const pollingList = (
  subscription: SubscriptionsRequest['subscribe'][number],
): subscription is ReadSubscription =>
  'read' in subscription &&
  subscription.read.extension === 'projects' &&
  subscription.read.action === 'list' &&
  subscription.every === 4_000

const toggleSidebar = (page: Page) => page.locator('button[aria-label="Toggle sidebar"]').click()
const sidebarProjectBlock = (page: Page) => page.locator('aside [data-root-context="1"]')
async function closeSidebar(page: Page) {
  await page.mouse.click(380, 400)
  await page
    .locator('[inert]')
    .filter({ has: sidebarProjectBlock(page) })
    .waitFor({ state: 'attached' })
}

it('reads the running projects again each time the phone sidebar opens', async () => {
  const { page, startOther } = await setup()
  const listed = page.waitForResponse((response) =>
    response.url().endsWith('/extensions/projects/actions/list'),
  )
  await toggleSidebar(page)
  await sidebarProjectBlock(page).waitFor()
  await listed
  await page.locator('[data-project-switch]').waitFor({ state: 'detached' })
  await closeSidebar(page)
  await startOther()
  await toggleSidebar(page)
  await page.locator('[data-project-switch]').waitFor()
  expect(await page.locator('[data-project-switch]').textContent()).toContain('Switch project')
})

it('stops polling when the phone sidebar closes with the picker unfolded', async () => {
  const { page, startOther } = await setup()
  await startOther()
  await toggleSidebar(page)
  const opened = subscriptionChange(page, ({ subscribe }) => subscribe.some(pollingList))
  await page.locator('[data-project-switch]').click()
  await page.locator('#project-switch-list a').nth(1).waitFor()
  const { sub } = (await opened).subscribe.find(pollingList)!
  const closed = subscriptionChange(page, ({ unsubscribe }) => unsubscribe.includes(sub))
  await closeSidebar(page)
  expect((await closed).subscribe.some(pollingList)).toBe(false)
})
