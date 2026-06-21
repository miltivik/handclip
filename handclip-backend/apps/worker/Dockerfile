# Stage 1: Install dependencies
FROM node:20-alpine AS deps

RUN corepack enable pnpm

WORKDIR /app

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY libs ./libs

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM deps AS build

WORKDIR /app

COPY apps/worker ./apps/worker

RUN pnpm run build --filter=@handclip/worker

# Stage 3: Production runtime
FROM node:20-alpine AS production

RUN apk add --no-cache ffmpeg

RUN corepack enable pnpm

WORKDIR /app

COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/node_modules ./node_modules

# ponytail: strip devDeps. See API Dockerfile for the rationale.
RUN pnpm prune --prod

USER node
CMD ["node", "apps/worker/dist/main"]