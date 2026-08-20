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

## Setup

Requirements: Docker Compose, or Node.js 24 and pnpm 10.17.1 for local checks.

1. Copy `.env.example` to `.env`.
2. Set `LLM_API_KEY` to an OpenAI API key. `OPENAI_API_KEY` is also accepted.
3. Optionally adjust `LLM_MODEL`, `LLM_REASONING_EFFORT`, and the context limits in `.env`.

## Docker

Start the complete stack (Next.js BFF, NestJS agent, Redis, and MCP tools):

```bash
docker compose up --build
```

Then open <http://localhost:3000>. The API is internal to Docker on port 3001;
only the web application is published to the host. Stop the stack with
`docker compose down`. Redis history and generated artifacts are retained in
named volumes.

## Sample Q&A

**Q: Which files implement chat request streaming?**

**A:** The browser calls the Next.js route at `apps/web/src/app/api/chat/route.ts`.
It forwards the request to the NestJS API and streams SSE events back to the
browser.

**Q: Where is the model and its reasoning level configured?**

**A:** Set `LLM_MODEL` and `LLM_REASONING_EFFORT` in `.env`. The defaults are
`gpt-5.4-mini` and `medium`; the API validates that the reasoning level is
`low`, `medium`, or `high`.

**Q: Can you add a new file to this checkout?**

**A:** Yes. The agent can use its MCP writer tool to make an approved change in
the mounted workspace. Writes are sandboxed, rolled back when a turn fails,
and successful changes can be downloaded as a snapshot.

## Design notes

### Context-selection strategy

Each model turn includes the system prompt and the most recent four conversation
exchanges, so the current request and its immediate tool activity remain verbatim.
Older exchanges are compressed into a persisted summary. When a valid earlier
summary exists, only the exchanges added since that summary are summarized again.
The selector counts text and function-call arguments against `CONTEXT_TOKEN_BUDGET`
before sending a request. It reuses a prior summary if summarization fails, but
fails explicitly if the required recent context or the resulting summary exceeds
the budget. This preserves fresh detail while preventing unbounded prompt growth.

### Why the BFF keeps NestJS and the LLM key off the browser

The browser talks only to Next.js BFF routes, which keep the NestJS service on
the private Docker network and retain `LLM_API_KEY` in server-side environment
variables. This prevents a provider credential from being bundled into client
code or exposed in browser network requests. The BFF also owns the HTTP-only
session cookie and filters backend history and streamed events, so internal tool
arguments, tool results, and hidden reasoning do not become part of the browser
API contract.

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
