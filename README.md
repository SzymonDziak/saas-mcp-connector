# saas-mcp-connector

An [MCP](https://modelcontextprotocol.io) server that lets Claude Desktop, Claude Code and other MCP clients use a SaaS product's API safely: every call is scoped to one user's workspace, writes are gated, and the HTTP transport is rate limited.

> Reference implementation by Simon Dziak (App369). It runs against a small in-memory fake SaaS (projects and tasks) so you can try it with zero external services; the API client is a swappable interface for a real REST API. It is a demo, not a production deployment.

Node 22+, TypeScript, official `@modelcontextprotocol/sdk`, zod.

## Quick start

```bash
npm install && npm run build
npm test            # offline; builds first, then runs vitest
```

### Claude Code (stdio)

```bash
claude mcp add saas -e API_TOKEN=demo-token-alice -e READ_ONLY=true -- node /absolute/path/to/saas-mcp-connector/dist/index.js
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "saas": {
      "command": "node",
      "args": ["/absolute/path/to/saas-mcp-connector/dist/index.js"],
      "env": { "API_TOKEN": "demo-token-alice", "READ_ONLY": "true" }
    }
  }
}
```

### Remote (Streamable HTTP)

```bash
npm run start:http   # http://127.0.0.1:3000/mcp
claude mcp add --transport http saas http://127.0.0.1:3000/mcp --header "Authorization: Bearer demo-token-alice"
```

Demo tokens: `demo-token-alice` and `demo-token-bob` (workspace "acme"), `demo-token-mallory` (workspace "globex"). Put TLS in front of the HTTP port for anything beyond localhost.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_projects` | read | Projects in your workspace |
| `list_tasks` | read | Tasks, filter by `projectId`, `status`, `assignee`; `limit` (1-50) + `cursor` pagination |
| `get_task` | read | One task by id |
| `search` | read | Case-insensitive text search over project and task titles |
| `create_task` | write | Create a task (needs `confirm: true`) |
| `update_task_status` | write | `todo` / `in_progress` / `done` (needs `confirm: true`) |

Inputs are validated with zod. Read tools carry `readOnlyHint: true`; write tools do not, so clients can treat them differently.

## Security model

- **Per-user scoping.** The token is resolved to an `ApiClient` that is already bound to one workspace. Tools can't name a workspace, so cross-workspace access isn't expressible. Tests cover reads, search, listing and writes across workspaces.
- **Read-only mode.** `READ_ONLY=true` makes every write tool return an error, even with `confirm: true`.
- **Explicit confirmation.** Writes without `confirm: true` do nothing and tell the model to ask the user first.
- **Rate limiting (HTTP).** Token bucket per token (`RATE_BURST`, `RATE_PER_SEC`; defaults 30 and 1/s). Over the limit: `429` with `Retry-After`. Buckets are keyed by a hash of the token.
- **Stateless HTTP.** A fresh server is built per request from the caller's token, so there is no session state to leak between users. Missing or bad tokens get `401`.
- **Errors.** Failures come back as MCP tool errors (`isError: true`) with a readable message. Unexpected exceptions are logged to stderr and returned as a generic message; no stack traces or upstream details reach the model.
- **Secrets.** Tokens live in env/headers only. `.env.example` has placeholders.

## Using a real API

Implement `ApiClient` (`src/api.ts`) with `fetch` calls to your REST API and provide a `ClientFactory` that maps a token to a client sending `Authorization: Bearer <token>` upstream. Then replace `demoSaas()` in `src/index.ts` with your factory. Throw `ApiError` for messages that are safe to show the model (not found, validation); everything else is masked. The server doesn't change. Your API must still enforce authorization itself; this layer is defense in depth.

## Optional extension: OAuth

Not implemented. An OAuth version would add: the MCP authorization flow (protected-resource metadata, authorization-server discovery, PKCE), so users sign in through the browser instead of pasting tokens; token validation and expiry/refresh; scopes mapped to read vs write tools; and per-user consent and revocation. The SDK ships server-side auth helpers for this.

## Layout

```
src/api.ts         ApiClient interface, types, ApiError
src/fake-saas.ts   in-memory multi-workspace backend
src/server.ts      tool definitions, read-only/confirm gating, error mapping
src/http.ts        Streamable HTTP transport, auth, rate limiting
src/ratelimit.ts   token bucket
src/index.ts       stdio / http entrypoint
test/              vitest suites (offline)
```

MIT licensed.
