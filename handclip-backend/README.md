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

51 tests across 8 spec files:

| Package | Tests | Coverage |
|---|---|---|
| libs/shared | 32 | redact, validatePublicUrl (private ranges + return shape) |
| apps/api | 10 | zod-pipe, PerEmailThrottlerGuard, uploads (cap/ownership/integrity), notifications (role-based authz) |
| apps/worker | 9 | validate-path, transcription (Zod-typed segments) |

```bash
pnpm -r test         # all packages
pnpm --filter @handclip/api test
pnpm --filter @handclip/shared test
pnpm --filter @handclip/worker test
pnpm -r type-check   # type gate
```

Test files live next to source as `*.spec.ts`. Service-level tests use minimal
stubs (`as unknown as T` with a one-line reason) — no live Supabase/Redis
required. `tsc --noEmit` is the type gate; `pnpm -r type-check` runs it
across all packages.

## Env

See `apps/api/.env.example` and `apps/worker/.env.example`. The API does not
use any LLM key — only the worker talks to OpenAI.

## Security posture

- **Auth**: user JWT only (`@CurrentUser()`). RLS is the source of truth. Internal
  worker→API calls go through `X-Internal-API-Key`; the header is normalized to
  handle duplicate-header edge cases. Authority is checked via
  `user.role === 'internal'`, not token-string emptiness.
- **Rate limits**: global 300 req/min/IP. Per-email OTP throttler caps magic-link
  requests at 3/hour/recipient (blocks email-bombing). Per-route overrides on
  auth (5/min), uploads (10-1000/min), and others.
- **Uploads**: in-memory state, capped at 5 concurrent uploads per user;
  `completeUpload` enforces ownership + rejects incomplete-chunk sets
  before any storage write.
- **Worker**: the only place that holds `SUPABASE_SERVICE_ROLE_KEY`. FFmpeg via
  `child_process.spawn` (no shell, no `exec`).
- **SSRF**: `validatePublicUrl` blocks private IPv4 (incl. CGNAT 100.64/10 and
  TEST-NETs), loopback, IPv6 link-local, single-label hostnames, and internal
  service names. Returns `{url, resolvedIp}` so the consumer can connect by IP
  and defeat DNS rebinding — undici dispatcher integration is a known
  follow-up (current code uses the hostname, so DNS rebinding bypass is
  theoretically possible until then).
- **Boot**: `CORS_ORIGIN`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `REDIS_HOST`, `INTERNAL_API_KEY` are all required and fail-fast.
- **Process**: `uncaughtException` / `unhandledRejection` handlers, graceful
  shutdown with 10s timeout, trust-proxy configurable for deployments behind
  multiple LBs.
- **Logs**: catch-all filter redacts the query string from 5xx logs (tokens
  never leak to stdout).

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Infra (FFmpeg, restart policy, healthchecks 503) | done |
| 1 | Mobile client minimum functional | done |
| 2 | API security (Zod, ownership, push auth) | done |
| 3 | Worker reliability (lockDuration, FFmpeg cleanup, rollback) | done |
| 4 | Prod-grade (trust proxy, shutdown, indexes, prune) | done |
| 5 | Hygiene (PII redaction, timeouts, transcription hardening) | done |
| 6 | Security hardening (OTP throttler, upload DoS, SSRF, auth boundaries) | done |

Production audit: 36/36 P0 closed. 17 additional security findings closed
in phase 6 — see commit `b1763b4` for the full list. Known gap: 2.2 DNS
rebinding dispatcher integration (consumers still connect by hostname).
**Runtime E2E still unverified** — the gap between "compila" and
"funciona" needs `docker compose up` with real Supabase.
