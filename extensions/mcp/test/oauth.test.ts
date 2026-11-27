import { createServer } from 'node:http'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import mcp, { actions } from '../server.ts'
import type { McpServerStatus } from '../refs.ts'
import type { ExtensionHost } from '../../../server/extensions.ts'
import { removeTemp, temp, until } from '../../../test/helpers.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close()
})

/** An MCP server behind OAuth 2.1 like hq.mega.dev: a 401 names its resource metadata, the authorization server
 * registers public clients and requires PKCE S256. `revoke()` rejects the current access token. */
async function serveOAuth() {
  const accepted = new Set<string>()
  const refreshTokens = new Set<string>()
  let issued = 0
  const seen = { registrations: [] as unknown[], tokenRequests: [] as URLSearchParams[] }
  const issue = () => {
    issued++
    accepted.add(`at-${issued}`)
    refreshTokens.add(`rt-${issued}`)
    return {
      access_token: `at-${issued}`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: `rt-${issued}`,
    }
  }
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', (): void => {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const json = (status: number, value: unknown, headers = {}) => {
        response
          .writeHead(status, { 'content-type': 'application/json', ...headers })
          .end(JSON.stringify(value))
      }
      const path = new URL(request.url!, base).pathname
      if (path === '/.well-known/oauth-protected-resource')
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base] })
      if (path === '/.well-known/oauth-authorization-server')
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['none'],
          code_challenge_methods_supported: ['S256'],
          authorization_response_iss_parameter_supported: true,
        })
      if (path === '/register') {
        seen.registrations.push(JSON.parse(body))
        return json(201, {
          ...JSON.parse(body),
          client_id: 'client-1',
          token_endpoint_auth_method: 'none',
        })
      }
      if (path === '/token') {
        const form = new URLSearchParams(body)
        seen.tokenRequests.push(form)
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'code-1')
          return json(200, issue())
        if (
          form.get('grant_type') === 'refresh_token' &&
          refreshTokens.delete(form.get('refresh_token')!)
        )
          return json(200, issue())
        return json(400, { error: 'invalid_grant' })
      }
      if (path !== '/mcp') return json(404, {})
      if (request.method !== 'POST') return json(405, {})
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
      if (!token || !accepted.has(token))
        return json(
          401,
          { error: 'unauthorized' },
          {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
          },
        )
      const message = JSON.parse(body)
      if (message.id === undefined) return json(202, {})
      const results: Record<string, unknown> = {
        initialize: {
          protocolVersion: message.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'course', version: '1' },
        },
        'tools/list': { tools: [{ name: 'lesson', inputSchema: { type: 'object' } }] },
        'tools/call': { content: [{ type: 'text', text: `lesson for ${token}` }] },
      }
      json(200, { jsonrpc: '2.0', id: message.id, result: results[message.method] })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { url: `${base}/mcp`, issuer: base, seen, revoke: () => accepted.clear() }
}

async function open(root: string) {
  const closers: (() => Promise<void>)[] = []
  const host = {
    userHome: root,
    projectRoot: root,
    projectSettings: async () => ({}),
    resource: <T>(_key: string, create: () => T) => create(),
    system: () => ({
      process: { url: 'http://127.0.0.1:4747' },
      access: { origins: ['https://mac.tailnet.example'] },
    }),
    onOpen: (callback: () => Promise<void>) => void callback(),
    onClose: (callback: () => Promise<void>) => closers.push(callback),
  } as unknown as ExtensionHost
  const [tool] = (await mcp(host)).tools!
  const close = async () => {
    for (const closer of closers.splice(0)) await closer()
  }
  cleanup.push(close)
  const status = () => actions.status(null, { host } as never) as unknown as McpServerStatus[]
  const call = (name: string, args: unknown) => actions[name](args as never, { host } as never)
  const run = () =>
    tool.execute(
      { server: 'course', tool: 'lesson', args: {} },
      {} as never,
      {
        abortSignal: new AbortController().signal,
      } as never,
    )
  return { status, call, run, close }
}

it('signs in to an OAuth MCP server through its redirect to this page, keeps and refreshes the tokens', async () => {
  const root = await temp()
  cleanup.push(() => removeTemp(root))
  const course = await serveOAuth()
  await mkdir(join(root, '.ultimate'), { recursive: true })
  await writeFile(
    join(root, '.ultimate/settings.json'),
    JSON.stringify({ mcpServers: { course: { url: course.url } } }),
  )

  const first = await open(root)
  await until(() => first.status()[0].state === 'signin')
  expect(await first.run()).toMatchObject({
    isError: true,
    output: [{ text: expect.stringContaining('Sign in course') }],
  })
  await expect(
    first.call('signIn', { name: 'course', origin: 'https://evil.example' }),
  ).rejects.toThrow('not an address of this Ultimate')

  const { url } = (await first.call('signIn', {
    name: 'course',
    origin: 'https://mac.tailnet.example',
  })) as { url: string }
  const authorization = new URL(url)
  expect(authorization.origin + authorization.pathname).toBe(`${course.issuer}/authorize`)
  expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
    client_id: 'client-1',
    code_challenge_method: 'S256',
    redirect_uri: 'https://mac.tailnet.example/?mcp-oauth=course',
  })
  expect(course.seen.registrations).toMatchObject([
    { redirect_uris: ['https://mac.tailnet.example/?mcp-oauth=course'] },
  ])

  const back = new URL('https://mac.tailnet.example/?mcp-oauth=course')
  back.searchParams.set('code', 'code-1')
  back.searchParams.set('state', authorization.searchParams.get('state')!)
  back.searchParams.set('iss', course.issuer)
  expect(await first.call('completeSignIn', { name: 'course', url: back.href })).toMatchObject([
    { name: 'course', state: 'connected', tools: 1 },
  ])
  expect(course.seen.tokenRequests[0].get('code_verifier')).toMatch(/^[\w-]{43,}$/)
  expect((await stat(join(root, '.ultimate/mcp-oauth.json'))).mode & 0o777).toBe(0o600)
  expect(await first.run()).toMatchObject({ output: [{ text: 'lesson for at-1' }] })

  course.revoke()
  expect(await first.run()).toMatchObject({ output: [{ text: 'lesson for at-2' }] })
  await first.close()

  const restarted = await open(root)
  await until(() => restarted.status()[0].state === 'connected')
  expect(await restarted.run()).toMatchObject({ output: [{ text: 'lesson for at-2' }] })
  expect(course.seen.registrations).toHaveLength(1)
})
