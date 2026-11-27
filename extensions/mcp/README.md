Connects the MCP servers in `mcpServers` and lets agents use their tools through one `mcp` tool; the status line shows how many are connected.

## Settings

`mcpServers` takes the same shape as Claude Desktop and Cursor, so a server's config pastes in. Put it in `~/.ultimate/settings.json`, or in a project's `.ultimate/settings.json`:

```json
{
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"]
    },
    "my-server": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${MY_SERVER_TOKEN}" }
    }
  }
}
```

- **stdio:** `command`, optional `args`, `env` and `cwd` (default: the project root). The server inherits Ultimate's environment plus `env`.
- **Streamable HTTP:** `url` and optional `headers`. The legacy SSE transport is not supported.
- **Secrets:** `${NAME}` in `args`, `env`, `url` or `headers` is replaced by the secret `NAME` from the Secrets panel (⌘K → Secrets). Never write a token inline. Each such name is declared as a secret, so the Secrets panel lists it, set or missing, with the servers using it. A missing secret fails that server with its name and an Add button; saving it there connects the server again.
- **Precedence:** user and project servers merge by name; a project entry replaces a user entry of the same name. Project servers run commands, so they load only once the project's setup is trusted (`host.projectSettings()` is empty before).
- `"disabled": true` leaves a server out.

Saving either settings file reconnects every server.

## OAuth

A Streamable HTTP server without an `Authorization` header that answers 401 with an OAuth challenge (`WWW-Authenticate: Bearer resource_metadata=…`) shows **signed out** and a **Sign in** button; no setting is needed. Sign in opens the server's authorization page in a new tab. Ultimate registers itself there (Dynamic Client Registration) and uses PKCE. The authorization server redirects back to the address the page was opened on, `<origin>/?mcp-oauth=<name>`, so it works from the Mac (`http://127.0.0.1:<port>`) and from a phone over Tailscale (the tailnet HTTPS address). That page finishes the sign-in and the server connects. Only an address of this Ultimate (loopback on its port, or an origin its access rules allow) is accepted as the redirect.

Tokens live in `~/.ultimate/mcp-oauth.json` (mode 0600, refused when others can read it), keyed by server URL, never in settings or a repository. Every Ultimate process of the user shares them: access tokens refresh shortly before they expire and after a 401, under a file lock so two processes never spend one rotating refresh token. When refreshing fails, the server goes back to signed out. A sign-in waits in memory: a restart between pressing Sign in and coming back means pressing Sign in again. Signing in from another address registers another client and replaces the tokens. A server whose challenge names no resource metadata fails as before and needs credentials in headers. To sign out, remove its entry from `~/.ultimate/mcp-oauth.json`.

## Tool

`mcp {server}` lists a server's tools with their input schemas; `mcp {server, tool, args}` calls one and returns its text and images. A result the server marks as an error comes back as a tool error. An error the server raises for bad arguments carries the tool's input schema. The tool's description names the configured servers, so the prompt changes only when the configuration does, however many tools they have. In codemode, `tools.mcp(...)` runs many calls and filters their results.

Every agent that inherits tools gets `mcp`, and @ultimate lists it in `agents/ultimate.md`. Agents with an explicit `tools` list add it there.

Calls are `replay: 'unsafe'`: a call interrupted by a restart is reported as interrupted, never sent again. A call times out after 10 minutes without progress from the server. A call the server refuses with HTTP 429 (rate limited), or one the agent aborts, comes back as a tool error and keeps the connection.

## Lifecycle

Servers connect when the server opens, each on its own: a failing one never blocks another or a turn. A failure or a dropped connection retries after 5 s, doubling up to 5 minutes. The servers close (stdio: the whole process group) when the extension reloads or Ultimate stops. A server's `tools/list_changed` notification refreshes its tool list.

## UI

The status line's `mcp 2/3` chip counts connected out of configured servers, turns red while one failed or is signed out, and is hidden when none is configured. Its popover lists each server with its transport, source, state or tool count, the error and the next retry, and a reconnect button. The Extensions panel's `mcp` row lists the same servers when opened.

Actions: `status` → every server's state; `reconnect {name}` → connects one again and returns the states; `signIn {name, origin}` and `completeSignIn {name, url}` (user only) run the two halves of an OAuth sign-in.
