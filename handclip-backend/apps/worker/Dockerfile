# Stage 1: Install dependencies
FROM node:22.19-alpine AS deps

RUN corepack enable pnpm

WORKDIR /app

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY libs ./libs
COPY apps/worker/package.json ./apps/worker/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM deps AS build

WORKDIR /app

COPY apps/worker ./apps/worker

RUN pnpm run build --filter=@handclip/worker

# Stage 3: Production runtime
FROM node:22.19-alpine AS production

RUN corepack enable pnpm

WORKDIR /app

# Copy built artifacts and pnpm workspace links
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/libs ./libs
COPY --from=build /app/dist/libs/shared ./libs/shared/dist
COPY --from=build /app/node_modules ./node_modules

WORKDIR /app/apps/worker

ENV NODE_PATH=/app/apps/worker/node_modules:/app/libs/shared/node_modules:/app/node_modules

CMD ["node", "../../dist/apps/worker/src/main.js"]
