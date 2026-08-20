FROM node:24-bookworm-slim AS base

WORKDIR /app
RUN corepack enable

FROM base AS build-tools

RUN apt-get update && apt-get install --no-install-recommends --yes g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

FROM build-tools AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp-search/package.json apps/mcp-search/package.json
COPY apps/mcp-writer/package.json apps/mcp-writer/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS runtime

COPY apps/api apps/api
COPY apps/mcp-search apps/mcp-search
COPY apps/mcp-writer apps/mcp-writer
COPY packages/contracts packages/contracts

CMD ["pnpm", "--filter", "@chat-app/api", "exec", "tsx", "src/main.ts"]
