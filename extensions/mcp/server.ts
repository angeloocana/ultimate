import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { map, obj, opt, str, unknown } from '@earendil-works/pi-schema'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { JsonObject } from '@earendil-works/pi-durable'
import {
  McpAbortError,
  McpClient,
  McpError,
  McpHttpError,
  McpTimeoutError,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
} from '@earendil-works/pi-mcp'
import type { Tool } from '@earendil-works/pi-mcp'
import {
  completeMcpSignIn,
  createMcpAuthProvider,
  McpOAuthAuthorizationRequiredError,
  responseFromRedirectUrl,
  startMcpSignIn,
} from '@earendil-works/pi-mcp/oauth'
import type {
  McpAuthProvider,
  McpSignInOptions,
  McpSignInRedirect,
  OAuthChallenge,
} from '@earendil-works/pi-mcp/oauth'
import { implementAction } from '../../lib/actions.ts'
import { readSecret } from '../../lib/secrets.ts'
import { retryAfter, type Cancel } from '../../lib/timers.shared.ts'
import { readSettings, userSettingsPath } from '../../lib/settings.ts'
import type { ExtensionAction } from '../../server/actions.ts'
import type { ExtensionHost } from '../../server/extensions.ts'
import { CompleteSignInAction, ReconnectAction, SignInAction, StatusAction } from './refs.ts'
import { oauthStore } from './oauth.ts'
import type { McpServerStatus } from './refs.ts'
import { rebuiltOnOpen } from '../../lib/errors.shared.ts'

export const reloadOnSettings = true
export const pollActions = ['status']
export const userActions = ['signIn', 'completeSignIn']

const PROGRESS_RENEWED_CALL_TIMEOUT_MS = 10 * 60_000
const FIRST_RETRY = 5_000
const rateLimited = (error: unknown) => error instanceof McpHttpError && error.status === 429
const LAST_RETRY = 5 * 60_000

type Entry =
  | { command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { url: string; headers: Record<string, string> }

type Server = Omit<McpServerStatus, 'tools'> & {
  entry?: Entry
  client?: McpClient
  auth?: McpAuthProvider
  challenge?: OAuthChallenge
  tools: Tool[]
  attempts: number
  cancelRetry?: Cancel
  connectionQueueTail?: Promise<void>
  resolvedSecretsForRedaction: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')
const record = (value: unknown) =>
  isObject(value) && Object.values(value).every((v) => typeof v === 'string')

function entryOf(value: unknown): Entry | string {
  if (!isObject(value)) return 'must be an object'
  if (typeof value.url === 'string') {
    if (value.type === 'sse')
      return 'the legacy SSE transport is not supported; use Streamable HTTP'
    if (value.headers !== undefined && !record(value.headers))
      return 'headers must map names to strings'
    return { url: value.url, headers: (value.headers as Record<string, string>) ?? {} }
  }
  if (typeof value.command !== 'string') return 'needs a command or a url'
  if (value.args !== undefined && !strings(value.args)) return 'args must be a list of strings'
  if (value.env !== undefined && !record(value.env)) return 'env must map names to strings'
  return {
    command: value.command,
    args: (value.args as string[]) ?? [],
    env: (value.env as Record<string, string>) ?? {},
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
  }
}

const SECRET = /\$\{([A-Z][A-Z0-9_]*)\}/g

const placeholders = (entry: Entry) =>
  ('url' in entry
    ? [entry.url, ...Object.values(entry.headers)]
    : [...entry.args, ...Object.values(entry.env)]
  ).flatMap((value) => [...value.matchAll(SECRET)].map(([, name]) => name))

class MissingSecret extends Error {
  secret: string
  constructor(secret: string) {
    super(`Missing secret ${secret}: add it in the Secrets panel (⌘K → Secrets)`)
    this.secret = secret
  }
}

async function expandLiteralSecrets(home: string, value: string, found: string[]) {
  const values = new Map<string, string>()
  for (const [, name] of value.matchAll(SECRET)) {
    const secret = await readSecret(home, name)
    if (secret === undefined) throw new MissingSecret(name)
    values.set(name, secret)
    found.push(secret)
  }
  return value.replace(SECRET, (_token, name: string) => values.get(name)!)
}
const expandAll = async (home: string, values: Record<string, string>, found: string[]) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(values).map(async ([key, value]) => [
        key,
        await expandLiteralSecrets(home, value, found),
      ]),
    ),
  ) as Record<string, string>

const redact = (server: Server, error: unknown) =>
  server.resolvedSecretsForRedaction.reduce(
    (text, secret) => text.replaceAll(secret, '***'),
    error instanceof Error ? error.message : String(error),
  )

async function configured(host: ExtensionHost) {
  const layers: [McpServerStatus['source'], JsonObject][] = [
    ['user', await readSettings(userSettingsPath(host.userHome))],
    ['project', await host.projectSettings()],
  ]
  const servers = new Map<string, Server>()
  for (const [source, settings] of layers) {
    const entries = settings.mcpServers
    if (entries === undefined) continue
    if (!isObject(entries)) throw new Error(`mcpServers in ${source} settings must be an object`)
    for (const [name, value] of Object.entries(entries)) {
      servers.delete(name)
      if (isObject(value) && value.disabled === true) continue
      const entry = entryOf(value)
      servers.set(name, {
        name,
        source,
        transport: isObject(value) && typeof value.url === 'string' ? 'http' : 'stdio',
        ...(typeof entry === 'string'
          ? { state: 'failed', error: `Invalid entry: ${entry}` }
          : { state: 'connecting', entry }),
        tools: [],
        attempts: 0,
        resolvedSecretsForRedaction: [],
      })
    }
  }
  return servers
}

export async function secrets(host: ExtensionHost) {
  const users = new Map<string, Set<string>>()
  for (const server of (await configured(host)).values())
    for (const name of server.entry ? placeholders(server.entry) : [])
      users.set(name, (users.get(name) ?? new Set()).add(server.name))
  return [...users].map(([name, servers]) => ({
    name,
    description: `Used by the MCP server${servers.size > 1 ? 's' : ''} ${[...servers].join(', ')}`,
  }))
}

const listing = (server: Server) =>
  [
    `${server.name}: ${server.tools.length} tools. Call one with mcp {server, tool, args}.`,
    ...server.tools.map(
      (tool) =>
        `\n${tool.name}: ${tool.description?.trim() ?? tool.title ?? ''}\n  input: ${JSON.stringify(tool.inputSchema)}`,
    ),
  ].join('\n')
const schemaOf = (tool: Tool) => `${tool.name} input: ${JSON.stringify(tool.inputSchema)}`
const renewTimeoutOnProgress = () => {}
const failure = (text: string) => ({ output: [{ type: 'text' as const, text }], isError: true })

const sendsOwnAuthorization = (entry: Entry) =>
  'url' in entry && Object.keys(entry.headers).some((name) => /^authorization$/i.test(name))

const oauthUrl = (server: Server) => {
  if (!server.entry || !('url' in server.entry) || sendsOwnAuthorization(server.entry))
    throw new Error(`MCP server ${server.name} does not sign in with OAuth`)
  if (server.entry.url.includes('${'))
    throw new Error(`MCP server ${server.name}: OAuth needs a url without secrets`)
  return server.entry.url
}

function redirectUrlFor(host: ExtensionHost, name: string, origin: unknown) {
  if (typeof origin !== 'string') throw new Error('signIn: origin is required')
  const page = new URL(origin)
  const own = new URL(host.system().process.url)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(page.hostname)
  const known =
    page.origin === origin &&
    ((loopback && page.port === own.port && page.protocol === own.protocol) ||
      host.system().access.origins.includes(origin))
  if (!known) throw new Error(`signIn: ${origin} is not an address of this Ultimate`)
  const url = new URL('/', origin)
  url.searchParams.set('mcp-oauth', name)
  return url.href
}

type PendingSignIn = { options: McpSignInOptions; authorization: McpSignInRedirect }

const views = new WeakMap<
  ExtensionHost,
  {
    status(): McpServerStatus[]
    reconnect(name: string): Promise<void>
    signIn(name: string, origin: unknown): Promise<{ url?: string }>
    completeSignIn(name: string, url: unknown): Promise<void>
  }
>()

export const actions: Record<string, ExtensionAction> = {
  status: implementAction(StatusAction, (_args, { host }) => views.get(host)?.status() ?? []),
  reconnect: implementAction(ReconnectAction, async (args, { host }) => {
    const view = views.get(host)
    const name = isObject(args) ? args.name : undefined
    if (!view || typeof name !== 'string') throw new Error('reconnect: name is required')
    await view.reconnect(name)
    return view.status()
  }),
  signIn: implementAction(SignInAction, async (args, { host }) => {
    const view = views.get(host)
    const name = isObject(args) ? args.name : undefined
    if (!view || typeof name !== 'string') throw new Error('signIn: name is required')
    return view.signIn(name, isObject(args) ? args.origin : undefined)
  }),
  completeSignIn: implementAction(CompleteSignInAction, async (args, { host }) => {
    const view = views.get(host)
    const name = isObject(args) ? args.name : undefined
    if (!view || typeof name !== 'string') throw new Error('completeSignIn: name is required')
    await view.completeSignIn(name, isObject(args) ? args.authorizationResponse : undefined)
    return view.status()
  }),
}

export default async function mcp(host: ExtensionHost) {
  const servers = await configured(host)
  const pendingSignIns = host.resource('mcp.signins', () => new Map<string, PendingSignIn>())
  let closed = false

  function needsSignIn(server: Server) {
    server.client = undefined
    server.state = 'signin'
    server.attempts = 0
  }

  function authFor(server: Server, entry: Entry) {
    delete server.challenge
    if (!('url' in entry) || sendsOwnAuthorization(entry)) return undefined
    const auth = createMcpAuthProvider({
      serverUrl: entry.url,
      store: oauthStore(host.userHome, entry.url),
      settings: () => ({}),
      clientName: 'Ultimate',
      onChallenge: (challenge) => (server.challenge = challenge),
    })
    server.auth = auth
    return {
      ...auth,
      token: () =>
        auth.token().catch((error: unknown) => {
          console.warn(`MCP ${server.name}: no stored OAuth token: ${redact(server, error)}`)
          return undefined
        }),
    }
  }

  function signInOptions(server: Server, redirectUrl: string): McpSignInOptions {
    const serverUrl = oauthUrl(server)
    return {
      serverUrl,
      store: oauthStore(host.userHome, serverUrl),
      settings: {},
      clientName: 'Ultimate',
      redirectUrl,
      ...(server.challenge ? { challenge: server.challenge } : {}),
    }
  }

  function fail(server: Server, error: string) {
    server.client = undefined
    server.state = 'failed'
    server.error = error
    const delay = Math.min(FIRST_RETRY * 2 ** server.attempts++, LAST_RETRY)
    server.retryAt = Date.now() + delay
    server.cancelRetry = retryAfter(
      delay,
      () => rebuiltOnOpen('open reconnects every configured MCP server', begin(server)),
      { unref: true },
    )
  }

  async function connect(server: Server) {
    server.cancelRetry?.()
    delete server.retryAt
    delete server.error
    delete server.missing
    server.state = 'connecting'
    const entry = server.entry!
    const found: string[] = []
    server.resolvedSecretsForRedaction = found
    const client = new McpClient({
      name: 'ultimate',
      version: '1.0.0',
      roots: [{ uri: pathToFileURL(host.projectRoot).href, name: basename(host.projectRoot) }],
    })
    server.client = client
    client.onClose(() => {
      const activeConnectionDropped =
        !closed && server.client === client && server.state === 'connected'
      if (activeConnectionDropped) fail(server, 'Disconnected')
    })
    let stdio: StdioTransport | undefined
    try {
      const authProvider = authFor(server, entry)
      const transport =
        'url' in entry
          ? new StreamableHttpTransport({
              url: await expandLiteralSecrets(host.userHome, entry.url, found),
              headers: await expandAll(host.userHome, entry.headers, found),
              ...(authProvider ? { authProvider } : {}),
            })
          : (stdio = new StdioTransport({
              command: entry.command,
              args: await Promise.all(
                entry.args.map((arg) => expandLiteralSecrets(host.userHome, arg, found)),
              ),
              env: await expandAll(host.userHome, entry.env, found),
              cwd: entry.cwd ?? host.projectRoot,
            }))
      await client.connect(transport)
      client.onNotification('notifications/tools/list_changed', () => {
        rebuiltOnOpen(
          'open reconnects MCP servers and lists their tools again',
          client
            .listTools()
            .then((tools) => {
              if (server.client === client) server.tools = tools
            })
            .catch((error: unknown) =>
              console.warn(`MCP ${server.name}: tools/list: ${redact(server, error)}`),
            ),
        )
      })
      const tools = await client.listTools()
      if (closed || server.client !== client) return
      server.tools = tools
      server.state = 'connected'
      server.attempts = 0
    } catch (error) {
      if (closed || server.client !== client) return
      const oauth = error instanceof McpOAuthAuthorizationRequiredError
      if (oauth && server.challenge?.resourceMetadataUrl) {
        needsSignIn(server)
        await close(client)
        return
      }
      if (error instanceof MissingSecret) server.missing = error.secret
      const stderr = stdio?.stderr.trim().split('\n').at(-1)
      fail(
        server,
        oauth
          ? 'Unauthorized (HTTP 401) without an OAuth challenge: add credentials in headers'
          : [redact(server, error), stderr && redact(server, stderr)].filter(Boolean).join(': '),
      )
      await close(client)
    }
  }

  async function close(client: McpClient | undefined) {
    try {
      await client?.close()
    } catch (error) {
      console.warn('MCP close', error instanceof Error ? error.message : error)
    }
  }

  function queueSingleConnection(server: Server, work: () => Promise<void>) {
    const next = (server.connectionQueueTail ?? Promise.resolve()).then(work)
    server.connectionQueueTail = next
    rebuiltOnOpen(
      'open reconnects every configured MCP server with a fresh connection queue',
      next.finally(() => {
        if (server.connectionQueueTail === next) delete server.connectionQueueTail
      }),
    )
    return next
  }

  function begin(server: Server) {
    if (closed || !server.entry) return Promise.resolve()
    return server.connectionQueueTail ?? queueSingleConnection(server, () => connect(server))
  }

  function restart(server: Server) {
    if (closed || !server.entry) return Promise.resolve()
    return queueSingleConnection(server, async () => {
      const previous = server.client
      server.client = undefined
      await close(previous)
      server.attempts = 0
      await connect(server)
    })
  }

  views.set(host, {
    status: () =>
      [...servers.values()].map((server) => ({
        name: server.name,
        source: server.source,
        transport: server.transport,
        state: server.state,
        ...(server.state === 'connected' ? { tools: server.tools.length } : {}),
        ...(server.error ? { error: server.error } : {}),
        ...(server.missing ? { missing: server.missing } : {}),
        ...(server.retryAt ? { retryAt: server.retryAt } : {}),
      })),
    async reconnect(name) {
      await restart(named(name))
    },
    async signIn(name, origin) {
      const server = named(name)
      const options = signInOptions(server, redirectUrlFor(host, name, origin))
      const started = await startMcpSignIn(options)
      if (started.kind === 'authorized') {
        await restart(server)
        return {}
      }
      pendingSignIns.set(name, { options, authorization: started })
      return { url: started.authorizationUrl }
    },
    async completeSignIn(name, url) {
      const server = named(name)
      const pending = pendingSignIns.get(name)
      if (!pending) throw new Error(`The sign-in to ${name} expired: press Sign in again`)
      if (typeof url !== 'string')
        throw new Error('completeSignIn: authorizationResponse is required')
      const response = responseFromRedirectUrl(url, pending.authorization)
      pendingSignIns.delete(name)
      await completeMcpSignIn({
        ...pending.options,
        authorization: pending.authorization,
        response,
      })
      await restart(server)
    },
  })

  function named(name: string) {
    const server = servers.get(name)
    if (!server) throw new Error(`No MCP server named ${name}`)
    return server
  }

  let started = false
  host.onOpen(async () => {
    if (started) return
    started = true
    for (const server of servers.values())
      rebuiltOnOpen('open reconnects every configured MCP server', begin(server))
  })
  host.onClose(async () => {
    closed = true
    for (const server of servers.values()) server.cancelRetry?.()
    await Promise.all(
      [...servers.values()].map(async (server) => {
        await server.auth?.settled()
        await close(server.client)
      }),
    )
  })

  const names = [...servers.keys()]
  return defineExtension({
    name: 'mcp',
    tools: names.length
      ? [
          defineTool({
            name: 'mcp',
            description:
              `Use the tools of the configured MCP servers: ${names.join(', ')}. ` +
              "mcp {server} lists a server's tools with their input schemas; mcp {server, tool, args} calls one. " +
              'In codemode, tools.mcp(...) runs many calls and filters their results.',
            parameters: obj({
              server: str({ description: `One of: ${names.join(', ')}` }),
              tool: opt(str({ description: "The tool to call; omit to list the server's tools" })),
              args: opt(
                map(unknown(), {
                  description: "The tool's arguments, matching its input schema",
                }),
              ),
            }),
            async execute({ server: name, tool, args }, _api, context) {
              const server = servers.get(name)
              if (!server)
                return failure(`No MCP server named ${name}. Configured: ${names.join(', ')}`)
              await server.connectionQueueTail
              if (server.state === 'signin')
                return failure(
                  `MCP server ${name} needs a sign-in: ask the user to press Sign in ${name} on the mcp chip in the status line`,
                )
              if (server.state !== 'connected' || !server.client)
                return failure(
                  `MCP server ${name} is ${server.state}: ${server.error ?? 'not connected'}`,
                )
              if (!tool) return { output: [{ type: 'text', text: listing(server) }] }
              const client = server.client
              try {
                const result = await client.callTool(tool, args ?? {}, {
                  signal: context.abortSignal,
                  timeoutMs: PROGRESS_RENEWED_CALL_TIMEOUT_MS,
                  onProgress: renewTimeoutOnProgress,
                })
                return { output: toLlmContent(result), isError: result.isError === true }
              } catch (error) {
                const brokenConnectionNoResend = !(
                  rateLimited(error) ||
                  context.abortSignal?.aborted ||
                  error instanceof McpError ||
                  error instanceof McpTimeoutError ||
                  error instanceof McpAbortError
                )
                if (brokenConnectionNoResend && server.client === client)
                  rebuiltOnOpen('open reconnects every configured MCP server', restart(server))
                const known = server.tools.find((entry) => entry.name === tool)
                return failure(
                  `MCP ${name}/${tool} failed: ${redact(server, error)}` +
                    (error instanceof McpError && known ? `\n${schemaOf(known)}` : ''),
                )
              }
            },
          }),
        ]
      : [],
  })
}
