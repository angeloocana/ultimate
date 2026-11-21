// The phone sidebar keeps its children mounted once it opened, so the project picker once kept the list it read on
// first open (a lone project hid it for good) and kept polling every 4 s after the sidebar closed with it unfolded.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { afterEach, expect, it } from 'vitest'
import { browserBinary } from '../../../browser/server.ts'
import { fauxServer, removeTemp, temp } from '../../../../test/helpers.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close()
})

async function setup() {
  const userHome = await temp('ultimate-phone-switch-')
  cleanup.push(() => removeTemp(userHome))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot: resolve('.'),
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
  const stopOther = () => rm(other, { recursive: true, force: true })
  const browser = await chromium.launch({
    executablePath: await browserBinary(),
    headless: true,
    env: { ...process.env, TMPDIR: undefined },
  })
  cleanup.push(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  let lists = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/extensions/projects/actions/list')) lists++
  })
  await page.clock.install()
  await page.goto(`${server.url}/?conversation=1`)
  await page.locator('button[aria-label="Toggle sidebar"]').waitFor()
  return { page, lists: () => lists, startOther, stopOther }
}

async function listsAfter(page: Page, ms: number, lists: () => number) {
  const before = lists()
  await page.clock.runFor(ms)
  await page.evaluate(() => fetch('/api/system'))
  return lists() - before
}

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
  const { page, lists, startOther } = await setup()
  await startOther()
  await toggleSidebar(page)
  await page.locator('[data-project-switch]').click()
  await page.locator('#project-switch-list a').nth(1).waitFor()
  expect(await listsAfter(page, 4_500, lists)).toBeGreaterThan(0)
  await closeSidebar(page)
  await page.clock.runFor(500)
  expect(await listsAfter(page, 9_000, lists)).toBe(0)
})
