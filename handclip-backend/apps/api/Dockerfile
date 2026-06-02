# Stage 1: Install dependencies
FROM node:22.19-alpine AS deps

RUN corepack enable pnpm

WORKDIR /app

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY libs ./libs
COPY apps/api/package.json ./apps/api/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM deps AS build

WORKDIR /app

COPY apps/api ./apps/api

RUN pnpm run build --filter=@handclip/api

# Stage 3: Production runtime
FROM node:22.19-alpine AS production

RUN corepack enable pnpm

WORKDIR /app

# Copy built artifacts and pnpm workspace links
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/libs ./libs
COPY --from=build /app/dist/libs/shared ./libs/shared/dist
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

WORKDIR /app/apps/api

ENV NODE_PATH=/app/apps/api/node_modules:/app/libs/shared/node_modules:/app/node_modules

CMD ["node", "../../dist/apps/api/src/main.js"]
