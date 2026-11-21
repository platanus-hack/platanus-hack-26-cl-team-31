# @team-31/mcp

MCP server (stdio) built with the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk).

## Tools

| Tool      | Status          | Description                                     |
| --------- | --------------- | ----------------------------------------------- |
| `echo`    | ✅ working       | Returns the given `message`. Connection check.  |
| `send`    | 🚧 stub          | Placeholder; returns "not implemented".         |
| `receive` | 🚧 stub          | Placeholder; returns "not implemented".         |

## Scripts

```bash
pnpm --filter @team-31/mcp dev        # run from source with watch (tsx)
pnpm --filter @team-31/mcp build      # compile to dist/
pnpm --filter @team-31/mcp start      # run compiled server
pnpm --filter @team-31/mcp inspect    # build + open MCP Inspector
```

## Use it from Claude Code

```bash
pnpm --filter @team-31/mcp build
claude mcp add team-31 -- node "$(pwd)/apps/mcp/dist/index.js"
```

## Adding / implementing a tool

1. Create `src/tools/<name>.ts` exporting `register<Name>Tool(server)`.
2. Register it in `src/tools/index.ts`.
3. For `send` / `receive`: replace the placeholder `inputSchema` and the
   `notImplemented(...)` handler with the real logic.

> stdout is reserved for the MCP protocol — log with `console.error`.
