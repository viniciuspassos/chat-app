FROM node:24-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @chat-app/api build

FROM node:24-alpine AS production

ENV NODE_ENV=production
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /workspace/apps/api/dist apps/api/dist

USER node
WORKDIR /workspace/apps/api
EXPOSE 3000

CMD ["node", "dist/main.js"]
