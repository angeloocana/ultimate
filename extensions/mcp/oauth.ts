import { createHash } from 'node:crypto'
import { chmod, mkdir, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { McpRefreshLockBusyError } from '@earendil-works/pi-mcp/oauth'
import type { McpOAuthServerStore, McpOAuthState } from '@earendil-works/pi-mcp/oauth'
import { isMissing, sqliteCode } from '../../lib/errors.shared.ts'
import { writeJson } from '../../lib/json-file.ts'
import { acquireLock } from '../../lib/lock.ts'

type Store = { servers: Record<string, McpOAuthState> }

const REFRESH_LOCK_WAIT_MS = 30_000
const WRITE_LOCK_WAIT_MS = 120_000

const directory = (userHome: string) => join(userHome, '.ultimate')
const storePath = (userHome: string) => join(directory(userHome), 'mcp-oauth.json')

async function readStore(userHome: string): Promise<Store> {
  let file
  try {
    file = await open(storePath(userHome), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (isMissing(error)) return { servers: {} }
    throw new Error('Cannot open the MCP sign-in store', { cause: error })
  }
  try {
    if ((await file.stat()).mode & 0o077)
      throw new Error(
        'MCP sign-in store permissions are unsafe. Run chmod 600 ~/.ultimate/mcp-oauth.json',
      )
    const data = JSON.parse(await file.readFile('utf8')) as Store
    if (!data?.servers || typeof data.servers !== 'object' || Array.isArray(data.servers))
      throw new Error(
        'Invalid MCP sign-in store; remove ~/.ultimate/mcp-oauth.json to sign in again',
      )
    return data
  } finally {
    await file.close()
  }
}

async function locked<T>(path: string, waitMs: number, fn: () => Promise<T>) {
  const lock = await acquireLock(path, { pid: process.pid }, waitMs)
  try {
    return await fn()
  } finally {
    await lock.close()
  }
}

async function update(userHome: string, change: (store: Store) => void) {
  await mkdir(directory(userHome), { recursive: true, mode: 0o700 })
  await chmod(directory(userHome), 0o700)
  await locked(storePath(userHome) + '.lock', WRITE_LOCK_WAIT_MS, async () => {
    const store = await readStore(userHome)
    change(store)
    await writeJson(storePath(userHome), store, { mode: 0o600 })
  })
}

export function oauthStore(userHome: string, serverUrl: string): McpOAuthServerStore {
  const refreshLock = join(
    directory(userHome),
    `mcp-oauth.${createHash('sha256').update(serverUrl).digest('hex').slice(0, 16)}.lock`,
  )
  return {
    load: async () => (await readStore(userHome)).servers[serverUrl],
    save: (state) =>
      update(userHome, (store) => {
        store.servers[serverUrl] = state
      }),
    async withRefreshLock(fn) {
      await mkdir(directory(userHome), { recursive: true, mode: 0o700 })
      const lock = await acquireLock(refreshLock, { pid: process.pid }, REFRESH_LOCK_WAIT_MS).catch(
        (error: unknown) => {
          const heldByAnotherProcess = error instanceof Error && sqliteCode(error.cause) === 5
          throw heldByAnotherProcess ? new McpRefreshLockBusyError() : error
        },
      )
      try {
        return await fn()
      } finally {
        await lock.close()
      }
    },
  }
}
