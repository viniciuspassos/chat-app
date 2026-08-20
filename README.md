# Chat App Codebase Copilot

This repository extends the original chat exercise into a codebase copilot. The
application is self-hosted: the MCP tools inspect and, when requested, write to
this checkout mounted at `/workspace`.

```text
Browser → Next.js BFF → NestJS agent → OpenAI Responses
                         ├─ Redis session/history/SSE replay
                         ├─ MCP search (stdio)
                         └─ MCP writer (stdio) → /workspace
```

## Run

1. Copy `.env.example` to `.env` and set `LLM_API_KEY`.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.

The browser talks only to the Next.js BFF. It receives text, tool status, file
progress, download links, and terminal events; it never receives provider keys,
tool arguments/results, or hidden reasoning. Sessions use an HTTP-only cookie
and Redis stores history plus replayable SSE events.

The workspace is the repository itself. The MCP sandbox blocks `.git`,
`node_modules`, secret files, binaries, traversal, and symlink escapes. A failed
turn rolls back its writes. Successful writes are snapshotted for download.

## Checks

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
