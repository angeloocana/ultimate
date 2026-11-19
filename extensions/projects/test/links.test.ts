import { expect, it } from 'vitest'
import { destination, onLoopback, shownPort, target } from '../links.ts'
import type { RunningProject } from '../refs.ts'

const published: RunningProject = {
  name: 'bot',
  url: 'http://127.0.0.1:4747',
  current: false,
  tailnetPort: 4752,
}
const unpublished: RunningProject = {
  name: 'neospin',
  url: 'http://127.0.0.1:4750',
  current: false,
}
const loopback = { hostname: '127.0.0.1', protocol: 'http:' }
const tailnet = { hostname: 'my-machine.tail1234.ts.net', protocol: 'https:' }

it('goes to the loopback address from a loopback page, whatever the tailnet says', () => {
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]', 'ultimate.localhost'])
    expect(onLoopback({ hostname, protocol: 'http:' })).toBe(true)
  expect(target(published, loopback)).toBe('http://127.0.0.1:4747/')
  expect(target(unpublished, loopback)).toBe('http://127.0.0.1:4750/')
  expect([shownPort(published, loopback), shownPort(unpublished, loopback)]).toEqual([
    ':4747',
    ':4750',
  ])
})

it('goes to the page’s own host on the Tailscale port from a tailnet page, and nowhere for a project that is not published', () => {
  expect(onLoopback(tailnet)).toBe(false)
  expect(target(published, tailnet)).toBe('https://my-machine.tail1234.ts.net:4752/')
  expect(target(unpublished, tailnet)).toBeUndefined()
  expect([shownPort(published, tailnet), shownPort(unpublished, tailnet)]).toEqual([':4752', '—'])
})

it('gives a picker row a link only when it leads elsewhere, else the reason it does not', () => {
  expect(destination(published, tailnet)).toEqual({
    href: 'https://my-machine.tail1234.ts.net:4752/',
  })
  expect(destination(unpublished, tailnet)).toEqual({ reason: 'not on the tailnet' })
  expect(destination(unpublished, loopback)).toEqual({ href: 'http://127.0.0.1:4750/' })
  expect(destination({ ...published, current: true }, tailnet)).toEqual({ reason: 'this tab' })
})
