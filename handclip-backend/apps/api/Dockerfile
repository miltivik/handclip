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

COPY apps/api ./apps/api

RUN pnpm run build --filter=@handclip/api

# Stage 3: Production runtime
FROM node:20-alpine AS production

RUN corepack enable pnpm

WORKDIR /app

# Copy built artifacts and production node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/node_modules ./node_modules

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/main"]