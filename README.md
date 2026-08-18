# Chat Application

Full-stack chat exercise built with NestJS 11, React 19, Vite, and TypeScript. The API
echoes each accepted message with a `Bot:` prefix, while the browser keeps the conversation
history in memory.

## Requirements

- Node.js 24
- pnpm 10.17.1 through Corepack
- Docker with Docker Compose (optional)
- Chromium installed by Playwright for end-to-end tests

## Install and configure

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @chat-app/e2e exec playwright install chromium
```

The development commands read these variables:

| Variable              | Default/example         | Purpose                                  |
| --------------------- | ----------------------- | ---------------------------------------- |
| `PORT`                | `3000`                  | API listening port                       |
| `CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | Exact browser origin accepted by the API |
| `VITE_API_BASE_URL`   | `http://localhost:3000` | API URL embedded in the web build        |
| `API_PORT`            | `3000`                  | API port published by Docker Compose     |
| `WEB_PORT`            | `8080`                  | Web port published by Docker Compose     |

`PORT` and `CORS_ALLOWED_ORIGIN` are required by the API. The provided `.env.example` is
appropriate for local development. Vite exposes only variables prefixed with `VITE_` to the
browser.

## Development

Start the API and web app together:

```bash
set -a && . ./.env && set +a && pnpm dev
```

This command exports the example values before starting both workspace processes. On shells that
do not support `set -a`, export the three application variables shown above before running `pnpm
dev`. Open <http://localhost:5173>. The API listens on <http://localhost:3000>.

The composer sends with the **Send** button or Enter. While a request is active, it clears and
disables the input, displays `Typing…`, and prevents duplicate submissions. New messages scroll
into view automatically. A successful request restores focus to the input; a failed request also
restores the submitted text so it can be retried.

Useful workspace commands:

| Command             | Purpose                              |
| ------------------- | ------------------------------------ |
| `pnpm lint`         | Lint every package                   |
| `pnpm format:check` | Check formatting                     |
| `pnpm typecheck`    | Type-check every package             |
| `pnpm test`         | Run configured package test suites   |
| `pnpm test:e2e`     | Run the Playwright suite in Chromium |
| `pnpm build`        | Build all buildable packages         |

The Playwright suite starts real NestJS and Vite servers. It uses isolated server instances for
the normal and rate-limit flows so tests do not share throttling state.

## API

### `POST /chat`

Request:

```json
{
  "message": "Hello"
}
```

Successful response (`200 OK`):

```json
{
  "reply": "Bot: Hello"
}
```

Leading and trailing whitespace is removed before replying. Missing, non-string, empty, or
whitespace-only messages are rejected with `400 Bad Request`; unknown request fields are also
rejected. The endpoint accepts five requests per client IP in 60 seconds and responds with `429
Too Many Requests` from the sixth request onward.

The web app maps failures to stable, non-sensitive messages:

| Failure                             | Browser message                              |
| ----------------------------------- | -------------------------------------------- |
| `400`                               | `Message cannot be empty.`                   |
| `429`                               | `Too many messages, please try again later.` |
| `5xx` or an invalid success payload | `Service unavailable, please retry.`         |
| Other `4xx`                         | `Request could not be completed.`            |
| Network failure                     | `Connection lost, please retry.`             |

## Docker

Build and start both services:

```bash
pnpm docker:up
```

Then open <http://localhost:8080>. The web container is served by an unprivileged Nginx process,
and the API container runs as the non-root Node user. Both application images use multi-stage
builds.

Compose defaults to `http://localhost:8080` for the API's allowed origin and embeds
`http://localhost:3000` as the browser-facing API URL. When overriding published ports, update
`CORS_ALLOWED_ORIGIN` and `VITE_API_BASE_URL` together so the browser URLs remain consistent.

Stop the stack with:

```bash
docker compose down
```

## Architecture and limits

- `apps/api`: NestJS HTTP API with validation, CORS, JSON logs, and in-memory throttling.
- `apps/web`: React single-page app built by Vite and served by Nginx in production.
- `apps/e2e`: Playwright browser tests, targeting Chromium only.
- `packages/contracts`: request and response TypeScript interfaces shared by the apps.

There is no database, authentication, WebSocket transport, AI integration, or persistent browser
storage. Refreshing the page clears the conversation. The rate limiter is process-local, resets
when the API restarts, and is not coordinated across replicas. The API is exposed directly in the
Compose setup and does not trust forwarded client-IP headers by default.
