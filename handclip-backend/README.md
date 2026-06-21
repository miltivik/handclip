# HandClip Backend

NestJS monorepo: API (port 3000) + BullMQ worker (port 3001) + shared lib.
Backs the `handclip-app` Expo client. Renders short-form clips (9:16) from long videos.

## Quick start

```bash
# 1. Copy env templates and fill values
cp apps/api/.env.example    apps/api/.env
cp apps/worker/.env.example apps/worker/.env

# 2. Install + build + test
pnpm install
pnpm -r build
pnpm -r test

# 3. Run locally (requires Redis + Supabase)
docker compose -f ../docker-compose.yml up redis
pnpm -r dev
```

End-to-end smoke test: `bash scripts/smoke-test-e2e.sh` (requires full stack up).

## Layout

- `apps/api/` — NestJS surface. SSE for job progress. JWT auth via SupabaseAuthGuard.
- `apps/worker/` — BullMQ processors: `transcription`, `clip-analysis`, `render`.
- `libs/shared/` — DTOs, zod schemas, constants, pure utils (`validatePublicUrl`, `redactEmail`).
- `scripts/` — smoke test scripts for end-to-end validation.

## Test

```bash
pnpm -r test         # all packages
pnpm --filter @handclip/api test
```

Test files live next to source as `*.spec.ts`. No mocks — pure logic and zod
schemas are the current surface; service-level tests come with the first real
Supabase project.

## Env

See `apps/api/.env.example` and `apps/worker/.env.example`. The API does not
use any LLM key — only the worker talks to OpenAI.

## Security posture

- API: user JWT only (`@CurrentUser()`). RLS is the source of truth for authorization.
- Worker: the only place that holds `SUPABASE_SERVICE_ROLE_KEY`. Calls API
  via `X-Internal-API-Key` header.
- SSRF: `validatePublicUrl` blocks private/loopback/IPv6 link-local.
- FFmpeg: explicit `string[]` argv + `child_process.spawn` (no shell).

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Infra (FFmpeg, restart policy, healthchecks 503) | done |
| 1 | Mobile client minimum functional | done |
| 2 | API security (Zod, ownership, push auth) | done |
| 3 | Worker reliability (lockDuration, FFmpeg cleanup, rollback) | done |
| 4 | Prod-grade (trust proxy, shutdown, indexes, prune) | done |
| 5 | Hygiene (PII redaction, timeouts, transcription hardening) | done |

Production audit: 36/36 P0 closed. **Runtime E2E still unverified** — the gap
between "compila" and "funciona" needs `docker compose up` with real Supabase.
