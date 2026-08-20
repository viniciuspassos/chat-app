FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable
RUN apk add --no-cache g++ linux-headers make python3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp-search/package.json apps/mcp-search/package.json
COPY apps/mcp-writer/package.json apps/mcp-writer/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @chat-app/web... --frozen-lockfile

COPY . .
RUN pnpm --filter @chat-app/web build

FROM node:24-alpine

WORKDIR /app
RUN corepack enable
COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@chat-app/web", "start"]
