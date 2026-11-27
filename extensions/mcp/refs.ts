/** MCP in the browser: each configured server's connection state, and the action that connects one again. Browser-safe. */
import { actionRef } from '../../shared/extension-api.ts'

/** One server from `mcpServers` in user or project settings, as the `mcp` tool sees it now. */
export type McpServerStatus = {
  name: string
  /** Which settings file it comes from; a project entry replaces a user one of the same name. */
  source: 'user' | 'project'
  transport: 'stdio' | 'http'
  /** `signin`: the server answered 401 with an OAuth challenge and no stored tokens work; a person signs in. */
  state: 'connecting' | 'connected' | 'failed' | 'signin'
  /** How many tools it offers, once connected. */
  tools?: number
  error?: string
  /** The `${NAME}` secret its last connect could not find, until it connects again. */
  missing?: string
  /** When the next attempt runs (ms), while it is failed. */
  retryAt?: number
}

/** No arguments → every configured server's state, in settings order. */
export const StatusAction = actionRef<null, McpServerStatus[]>('mcp', 'status')
/** `{ name }` → connects that server again now, and returns every server's state once it is connected or failed. */
export const ReconnectAction = actionRef<{ name: string }, McpServerStatus[]>('mcp', 'reconnect')
/**
 * `{ name, origin }` (user only) → `{ url }`, the authorization page to open, whose redirect returns to
 * `<origin>/?mcp-oauth=<name>`; or `{}` when stored tokens could be refreshed and the server connected.
 */
export const SignInAction = actionRef<{ name: string; origin: string }, { url?: string }>(
  'mcp',
  'signIn',
)
/**
 * `{ name, authorizationResponse }` (user only): the redirect URL the browser landed on, carrying the code (the name
 * keeps it out of the trace); exchanges its code, then connects.
 */
export const CompleteSignInAction = actionRef<
  { name: string; authorizationResponse: string },
  McpServerStatus[]
>('mcp', 'completeSignIn')
