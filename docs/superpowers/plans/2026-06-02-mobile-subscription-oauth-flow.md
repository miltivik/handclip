# Mobile Subscription OAuth Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mobile UI and backend support so registered Supabase users connect Codex or Anthropic subscriptions, select one provider, and run clip analysis with encrypted per-user OAuth credentials.

**Architecture:** API owns OAuth attempts and encrypted credential persistence. Worker resolves active provider by authenticated project owner before clip analysis and refreshes stored tokens through `pi-ai`. Mobile app adds `Configuracion`, provider flows, and anonymous-mode gates while preserving local exploration entry.

**Tech Stack:** Expo Router, React Native, Zustand, NestJS, Supabase, BullMQ, Vitest, Jest, AES-256-GCM, `@earendil-works/pi-ai`.

---

## File Structure

Create focused server units:

- `handclip-backend/libs/shared/src/ai-connections/credentials-crypto.ts`: AES-256-GCM JSON encryption.
- `handclip-backend/libs/shared/src/ai-connections/types.ts`: shared provider and encrypted payload types.
- `handclip-backend/apps/api/src/modules/auth/bearer-user.guard.ts`: resolve Supabase user from Bearer token.
- `handclip-backend/apps/api/src/modules/auth/current-user.decorator.ts`: read resolved user in controllers.
- `handclip-backend/apps/api/src/modules/ai-connections/ai-connections.service.ts`: encrypted DB CRUD.
- `handclip-backend/apps/api/src/modules/ai-connections/oauth-attempts.service.ts`: in-memory asynchronous OAuth attempts.
- `handclip-backend/apps/api/src/modules/ai-connections/ai-connections.controller.ts`: HTTP contract.
- `handclip-backend/apps/worker/src/providers/database-oauth-credentials.store.ts`: decrypt, refresh, re-encrypt worker credentials.
- `handclip-app/lib/account-required.ts`: shared anonymous-mode gate.
- `handclip-app/app/(tabs)/settings.tsx`: settings UI and OAuth interactions.

Modify existing orchestration only where needed:

- `docs/handclip/schemas/supabase-migration.sql`
- `handclip-backend/libs/shared/src/index.ts`
- `handclip-backend/apps/api/src/app.module.ts`
- `handclip-backend/apps/api/src/modules/projects/projects.controller.ts`
- `handclip-backend/apps/api/src/modules/projects/projects.service.ts`
- `handclip-backend/apps/api/src/modules/jobs/jobs.service.ts`
- `handclip-backend/apps/worker/src/providers/provider-manager.ts`
- `handclip-backend/apps/worker/src/processors/transcription.processor.ts`
- `handclip-backend/apps/worker/src/processors/clip-analysis.processor.ts`
- `handclip-app/services/api.ts`
- `handclip-app/app/(tabs)/_layout.tsx`
- `handclip-app/app/(tabs)/home.tsx`
- `handclip-app/app/import/index.tsx`
- `handclip-app/app/import/processing.tsx`
- `handclip-app/app/project/[id]/edit.tsx`
- `.env.example`, `docker-compose.yml`, `handclip-app/.env.example`

## Task 1: Record Baseline and Add Server Test Harness

**Files:**
- Modify: `handclip-backend/apps/api/package.json`
- Modify: `handclip-backend/pnpm-lock.yaml`
- Create: `handclip-backend/apps/api/jest.config.js`

- [ ] **Step 1: Capture baseline failures before feature edits**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/worker test
pnpm --filter @handclip/worker type-check
pnpm --filter @handclip/api type-check
cd ../handclip-app
pnpm exec tsc --noEmit
```

Expected: worker tests pass. Record existing API or app TypeScript failures separately; do not erase user changes.

- [ ] **Step 2: Install API Jest TypeScript harness**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api add -D jest ts-jest @types/jest
```

Expected: API package manifest and backend lockfile update.

- [ ] **Step 3: Add deterministic Jest config**

Create `handclip-backend/apps/api/jest.config.js`:

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
```

- [ ] **Step 4: Verify empty API suite runs**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test
```

Expected: PASS with no tests.

- [ ] **Step 5: Commit harness**

```powershell
git add handclip-backend/apps/api/package.json handclip-backend/apps/api/jest.config.js handclip-backend/pnpm-lock.yaml
git commit -m "test(api): add jest typescript harness"
```

## Task 2: Add SQL Model and Shared Credential Encryption

**Files:**
- Modify: `docs/handclip/schemas/supabase-migration.sql`
- Create: `handclip-backend/libs/shared/src/ai-connections/types.ts`
- Create: `handclip-backend/libs/shared/src/ai-connections/credentials-crypto.ts`
- Create: `handclip-backend/libs/shared/src/ai-connections/credentials-crypto.spec.ts`
- Modify: `handclip-backend/libs/shared/src/index.ts`
- Modify: `handclip-backend/libs/shared/package.json`

- [ ] **Step 1: Add failing encryption tests**

Create `handclip-backend/libs/shared/src/ai-connections/credentials-crypto.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, parseEncryptionKey } from './credentials-crypto';

const key = Buffer.alloc(32, 7).toString('base64');

describe('credentials crypto', () => {
  it('roundtrips oauth credentials', () => {
    const encrypted = encryptJson({ access: 'a', refresh: 'r', expires: 123 }, key);
    expect(decryptJson(encrypted, key)).toEqual({ access: 'a', refresh: 'r', expires: 123 });
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => parseEncryptionKey(Buffer.alloc(31).toString('base64'))).toThrow(
      'AI_CONNECTIONS_ENCRYPTION_KEY must decode to 32 bytes',
    );
  });

  it('rejects a different decryption key', () => {
    const encrypted = encryptJson({ access: 'secret' }, key);
    expect(() => decryptJson(encrypted, Buffer.alloc(32, 8).toString('base64'))).toThrow();
  });
});
```

Add Vitest to shared:

```powershell
cd handclip-backend
pnpm --filter @handclip/shared add -D vitest@3.2.4
```

Add script in `handclip-backend/libs/shared/package.json`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Run test and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/shared test
```

Expected: FAIL because `credentials-crypto.ts` does not exist.

- [ ] **Step 3: Implement shared types and AES-256-GCM helper**

Create `handclip-backend/libs/shared/src/ai-connections/types.ts`:

```ts
export type AiSubscriptionProvider = 'openai-codex' | 'anthropic';

export interface EncryptedCredentials {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsTag: string;
}
```

Create `handclip-backend/libs/shared/src/ai-connections/credentials-crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EncryptedCredentials } from './types';

export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('AI_CONNECTIONS_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptJson(value: unknown, keyValue: string): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', parseEncryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    credentialsCiphertext: ciphertext.toString('base64'),
    credentialsIv: iv.toString('base64'),
    credentialsTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptJson<T>(value: EncryptedCredentials, keyValue: string): T {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    parseEncryptionKey(keyValue),
    Buffer.from(value.credentialsIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.credentialsTag, 'base64'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(value.credentialsCiphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(cleartext.toString('utf8')) as T;
}
```

Export both files from `handclip-backend/libs/shared/src/index.ts`:

```ts
export * from './ai-connections/types';
export * from './ai-connections/credentials-crypto';
```

- [ ] **Step 4: Add additive SQL migration**

Append to `docs/handclip/schemas/supabase-migration.sql`:

```sql
create table if not exists public.ai_provider_connections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('openai-codex', 'anthropic')),
  credentials_ciphertext text not null,
  credentials_iv text not null,
  credentials_tag text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create unique index if not exists idx_ai_provider_connections_one_active
  on public.ai_provider_connections(user_id) where is_active;
alter table public.ai_provider_connections enable row level security;
```

- [ ] **Step 5: Run shared tests and build**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/shared test
pnpm --filter @handclip/shared build
```

Expected: all shared tests PASS and shared build succeeds.

- [ ] **Step 6: Commit model and encryption**

```powershell
git add docs/handclip/schemas/supabase-migration.sql handclip-backend/libs/shared handclip-backend/pnpm-lock.yaml
git commit -m "feat(shared): add encrypted ai connection model"
```

## Task 3: Add API Bearer User Guard

**Files:**
- Create: `handclip-backend/apps/api/src/modules/auth/current-user.decorator.ts`
- Create: `handclip-backend/apps/api/src/modules/auth/bearer-user.guard.ts`
- Create: `handclip-backend/apps/api/src/modules/auth/bearer-user.guard.spec.ts`
- Modify: `handclip-backend/apps/api/src/modules/auth/auth.module.ts`

- [ ] **Step 1: Write failing guard tests**

Create `handclip-backend/apps/api/src/modules/auth/bearer-user.guard.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { BearerUserGuard } from './bearer-user.guard';

const context = (authorization?: string) => ({
  switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
}) as any;

describe('BearerUserGuard', () => {
  it('rejects missing bearer token', async () => {
    const guard = new BearerUserGuard({ getClient: jest.fn() } as any);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches resolved user', async () => {
    const request = { headers: { authorization: 'Bearer token' } };
    const guard = new BearerUserGuard({
      getClient: () => ({ auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) } }),
    } as any);
    await expect(guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as any)).resolves.toBe(true);
    expect((request as any).user).toEqual({ id: 'u1' });
  });
});
```

- [ ] **Step 2: Run guard test and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test -- bearer-user.guard.spec.ts
```

Expected: FAIL because guard does not exist.

- [ ] **Step 3: Implement decorator and guard**

Create `current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().user,
);
```

Create `bearer-user.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class BearerUserGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Bearer token required');
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid bearer token');
    request.user = data.user;
    return true;
  }
}
```

Export guard from `auth.module.ts`.

- [ ] **Step 4: Run API tests**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test -- bearer-user.guard.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Bearer auth**

```powershell
git add handclip-backend/apps/api/src/modules/auth
git commit -m "feat(api): add bearer user guard"
```

## Task 4: Add Encrypted API Connection CRUD

**Files:**
- Create: `handclip-backend/apps/api/src/modules/ai-connections/ai-connections.service.ts`
- Create: `handclip-backend/apps/api/src/modules/ai-connections/ai-connections.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Create tests with mocked service-role Supabase chains for encrypted upsert,
metadata-only list, and active selection only for connected provider. Required
assertions:

```ts
expect(insert.credentials_ciphertext).not.toContain('refresh-secret');
expect(await service.list('u1')).toEqual([
  { provider: 'openai-codex', isActive: true, connectedAt: '2026-06-02T00:00:00.000Z' },
]);
await expect(service.setActive('u1', 'anthropic')).rejects.toThrow('Provider is not connected');
```

- [ ] **Step 2: Run service test and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test -- ai-connections.service.spec.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement service contract**

Implement methods:

```ts
list(userId: string): Promise<AiConnectionMetadata[]>
upsertCredentials(userId: string, provider: AiSubscriptionProvider, credentials: OAuthCredentials): Promise<void>
setActive(userId: string, provider: AiSubscriptionProvider): Promise<void>
disconnect(userId: string, provider: AiSubscriptionProvider): Promise<void>
```

Validate key in constructor so API fails fast:

```ts
private readonly encryptionKey: string;

constructor(private readonly supabase: SupabaseService, config: ConfigService) {
  this.encryptionKey = config.getOrThrow<string>('AI_CONNECTIONS_ENCRYPTION_KEY');
  parseEncryptionKey(this.encryptionKey);
}
```

Use `encryptJson(credentials, this.encryptionKey)`.
Use service-role Supabase client. Serialize field mapping:

```ts
{
  user_id: userId,
  provider,
  credentials_ciphertext: encrypted.credentialsCiphertext,
  credentials_iv: encrypted.credentialsIv,
  credentials_tag: encrypted.credentialsTag,
  updated_at: new Date().toISOString(),
}
```

`setActive` first verifies connection exists, then clears user active rows and activates target row.

- [ ] **Step 4: Run CRUD tests**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test -- ai-connections.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit CRUD**

```powershell
git add handclip-backend/apps/api/src/modules/ai-connections
git commit -m "feat(api): persist encrypted ai connections"
```

## Task 5: Add In-Memory OAuth Attempts and HTTP Endpoints

**Files:**
- Modify: `handclip-backend/apps/api/package.json`
- Modify: `handclip-backend/pnpm-lock.yaml`
- Create: `handclip-backend/apps/api/src/modules/ai-connections/oauth-attempts.service.ts`
- Create: `handclip-backend/apps/api/src/modules/ai-connections/oauth-attempts.service.spec.ts`
- Create: `handclip-backend/apps/api/src/modules/ai-connections/pi-ai-oauth.loader.ts`
- Create: `handclip-backend/apps/api/src/modules/ai-connections/ai-connections.controller.ts`
- Create: `handclip-backend/apps/api/src/modules/ai-connections/ai-connections.module.ts`
- Modify: `handclip-backend/apps/api/src/app.module.ts`

- [ ] **Step 1: Add `pi-ai` API dependency**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api add @earendil-works/pi-ai@0.78.0
```

- [ ] **Step 2: Write failing attempt tests**

Inject OAuth loader so tests use fake functions. Add these cases:

```ts
it('publishes Codex device code and persists successful credentials')
it('publishes Anthropic auth URL and resolves submitted manual input')
it('rejects attempt access by another user')
it('returns sanitized failure without pasted code')
```

Codex fake:

```ts
loginOpenAICodexDeviceCode: async ({ onDeviceCode }) => {
  onDeviceCode({ userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/device' });
  return { access: 'a', refresh: 'r', expires: 123 };
}
```

Anthropic fake:

```ts
loginAnthropic: async ({ onAuth, onManualCodeInput }) => {
  onAuth({ url: 'https://example.test/authorize' });
  await onManualCodeInput();
  return { access: 'a', refresh: 'r', expires: 123 };
}
```

- [ ] **Step 3: Run attempt tests and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test -- oauth-attempts.service.spec.ts
```

Expected: FAIL because attempt manager does not exist.

- [ ] **Step 4: Add native ESM loader**

Create `pi-ai-oauth.loader.ts`:

```ts
export interface PiAiOAuthLoginModule {
  loginOpenAICodexDeviceCode(options: {
    onDeviceCode: (info: { userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }) => void;
  }): Promise<{ access: string; refresh: string; expires: number; [key: string]: unknown }>;
  loginAnthropic(options: {
    onAuth: (info: { url: string; instructions?: string }) => void;
    onPrompt: (prompt: { message: string }) => Promise<string>;
    onManualCodeInput: () => Promise<string>;
  }): Promise<{ access: string; refresh: string; expires: number; [key: string]: unknown }>;
}

const nativeImport = new Function('specifier', 'return import(specifier)') as
  <T>(specifier: string) => Promise<T>;

export const loadPiAiOAuth = () =>
  nativeImport<PiAiOAuthLoginModule>('@earendil-works/pi-ai/oauth');
```

- [ ] **Step 5: Implement asynchronous attempt manager**

Use `randomUUID()`, map attempts by ID, 10-minute expiry, user ownership checks, and
sanitized errors. Public attempt shape:

```ts
interface PublicOAuthAttempt {
  id: string;
  provider: AiSubscriptionProvider;
  status: 'initializing' | 'awaiting-user' | 'connected' | 'failed' | 'expired';
  authorizationUrl?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresAt: string;
  error?: string;
}
```

For Codex call `loginOpenAICodexDeviceCode`. For Anthropic call `loginAnthropic` with
`onManualCodeInput` returning a promise resolved by `submitInput`. Constructor accepts:

```ts
constructor(
  private readonly connections: AiConnectionsService,
  private readonly oauthLoader = loadPiAiOAuth,
) {}
```

Start methods launch async completion without blocking HTTP response:

```ts
void this.run(attempt).catch((error) => {
  attempt.status = 'failed';
  attempt.error = error instanceof Error ? error.message : 'OAuth failed';
});
return this.toPublic(attempt);
```

- [ ] **Step 6: Add guarded controller and module**

Use `@UseGuards(BearerUserGuard)` on controller. Keep route provider validation in
service:

```ts
@Get()
list(@CurrentUser() user: { id: string }) { return this.connections.list(user.id); }

@Post(':provider/start')
start(@CurrentUser() user: { id: string }, @Param('provider') provider: string) {
  return this.attempts.start(user.id, provider);
}
```

Add exact remaining handlers:

```ts
@Get(':provider/attempts/:attemptId')
status(@CurrentUser() user: { id: string }, @Param('attemptId') id: string) {
  return this.attempts.get(user.id, id);
}

@Post(':provider/attempts/:attemptId/input')
input(@CurrentUser() user: { id: string }, @Param('attemptId') id: string, @Body() body: { input: string }) {
  return this.attempts.submitInput(user.id, id, body.input);
}

@Patch('active')
active(@CurrentUser() user: { id: string }, @Body() body: { provider: AiSubscriptionProvider }) {
  return this.connections.setActive(user.id, body.provider);
}

@Delete(':provider')
disconnect(@CurrentUser() user: { id: string }, @Param('provider') provider: AiSubscriptionProvider) {
  return this.connections.disconnect(user.id, provider);
}
```

Import `AiConnectionsModule` in `app.module.ts`.

- [ ] **Step 7: Run API tests and type-check**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test
pnpm --filter @handclip/api type-check
```

Expected: PASS.

- [ ] **Step 8: Commit API OAuth flow**

```powershell
git add handclip-backend/apps/api handclip-backend/pnpm-lock.yaml
git commit -m "feat(api): expose subscription oauth connections"
```

## Task 6: Authenticate Analysis Ownership and Forward User ID

**Files:**
- Create: `handclip-backend/apps/api/src/modules/projects/projects.service.spec.ts`
- Modify: `handclip-backend/apps/api/src/modules/projects/projects.service.ts`
- Modify: `handclip-backend/apps/api/src/modules/projects/projects.controller.ts`
- Modify: `handclip-backend/apps/api/src/modules/jobs/jobs.service.ts`

- [ ] **Step 1: Write failing ownership test**

Test service-role lookup:

```ts
await expect(service.assertOwnedBy('project-1', 'other-user')).rejects.toThrow(
  'Project not found',
);
await expect(service.assertOwnedBy('project-1', 'owner-user')).resolves.toEqual(
  expect.objectContaining({ id: 'project-1', user_id: 'owner-user' }),
);
```

- [ ] **Step 2: Run ownership test and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test -- projects.service.spec.ts
```

Expected: FAIL because `assertOwnedBy` does not exist.

- [ ] **Step 3: Implement guarded analysis endpoint**

Add:

```ts
async assertOwnedBy(projectId: string, userId: string) {
  const { data, error } = await this.supabaseService.getServiceRoleClient()
    .from('projects').select('*').eq('id', projectId).eq('user_id', userId).single();
  if (error || !data) throw new NotFoundException('Project not found');
  return data;
}
```

Guard only analysis route:

```ts
@UseGuards(BearerUserGuard)
@Post(':id/analyze')
async analyze(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() body: { videoUrl: string }) {
  await this.projectsService.assertOwnedBy(id, user.id);
  return this.jobsService.enqueueAnalysis(id, user.id, body.videoUrl);
}
```

Change queue payload:

```ts
interface AnalysisJob { projectId: string; userId: string; videoUrl: string; }
```

- [ ] **Step 4: Run API tests and type-check**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/api test
pnpm --filter @handclip/api type-check
```

Expected: PASS.

- [ ] **Step 5: Commit analysis ownership**

```powershell
git add handclip-backend/apps/api/src/modules/projects handclip-backend/apps/api/src/modules/jobs
git commit -m "feat(api): require owner for subscription analysis"
```

## Task 7: Add Worker Database OAuth Store

**Files:**
- Create: `handclip-backend/apps/worker/src/providers/database-oauth-credentials.store.ts`
- Create: `handclip-backend/apps/worker/src/providers/database-oauth-credentials.store.spec.ts`
- Modify: `handclip-backend/apps/worker/src/providers/pi-ai-loader.ts`

- [ ] **Step 1: Write failing worker store tests**

Cover active Codex, Anthropic, refresh persistence, and missing provider:

```ts
await expect(store.getActiveApiKey('u1')).resolves.toEqual({
  apiKey: 'token',
  provider: 'openai-codex',
  resultProvider: 'openai-codex',
});
await expect(store.getActiveApiKey('missing')).resolves.toBeNull();
expect(update).toHaveBeenCalledWith(expect.objectContaining({
  credentials_ciphertext: expect.any(String),
}));
```

- [ ] **Step 2: Run worker test and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/worker test -- database-oauth-credentials.store.spec.ts
```

Expected: FAIL because store does not exist.

- [ ] **Step 3: Extend OAuth loader type**

Update `PiAiOAuthModule.getOAuthApiKey` credentials type to:

```ts
Record<string, { access: string; refresh: string; expires: number; [key: string]: unknown }>
```

- [ ] **Step 4: Implement worker DB store**

Constructor dependencies:

```ts
constructor(
  private readonly supabase: SupabaseClient,
  private readonly encryptionKey: string,
  private readonly oauthLoader = loadPiAiOAuth,
) {}
```

Method:

```ts
getActiveApiKey(userId: string): Promise<{
  apiKey: string;
  provider: 'openai-codex' | 'anthropic';
  resultProvider: 'openai-codex' | 'anthropic-subscription';
} | null>
```

Read active row, decrypt JSON, load OAuth module, call
`getOAuthApiKey(provider, { [provider]: credentials })`, persist refreshed encrypted
credentials, return mapping:

```ts
const oauth = await this.oauthLoader();
const result = await oauth.getOAuthApiKey(row.provider, { [row.provider]: credentials });
if (!result) return null;
await this.persistRefresh(row.id, result.newCredentials);
return {
  apiKey: result.apiKey,
  provider: row.provider,
  resultProvider: row.provider === 'anthropic' ? 'anthropic-subscription' : 'openai-codex',
};
```

- [ ] **Step 5: Run worker tests**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/worker test
```

Expected: PASS.

- [ ] **Step 6: Commit DB credential store**

```powershell
git add handclip-backend/apps/worker/src/providers
git commit -m "feat(worker): resolve encrypted user oauth credentials"
```

## Task 8: Use User Provider During Clip Analysis

**Files:**
- Modify: `handclip-backend/apps/worker/src/providers/provider-manager.ts`
- Modify: `handclip-backend/apps/worker/src/providers/provider-manager.spec.ts`
- Modify: `handclip-backend/apps/worker/src/processors/transcription.processor.ts`
- Modify: `handclip-backend/apps/worker/src/processors/clip-analysis.processor.ts`
- Modify: `handclip-backend/apps/worker/src/processors/processors.module.ts`

- [ ] **Step 1: Add failing manager test for explicit user provider**

Add method expectation:

```ts
await expect(manager.callWithUserProvider(task, 'u1')).resolves.toEqual(result('openai-codex'));
expect(databaseStore.getActiveApiKey).toHaveBeenCalledWith('u1');
```

Also assert missing connection throws:

```ts
await expect(manager.callWithUserProvider(task, 'u1')).rejects.toThrow(
  'No active OAuth connection found for user',
);
```

- [ ] **Step 2: Run manager test and verify red**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/worker test -- provider-manager.spec.ts
```

Expected: FAIL because user-provider method does not exist.

- [ ] **Step 3: Add explicit user-provider path**

Add optional database reader:

```ts
interface DatabaseOAuthCredentialsReader {
  getActiveApiKey(userId: string): Promise<{
    apiKey: string;
    provider: 'openai-codex' | 'anthropic';
    resultProvider: 'openai-codex' | 'anthropic-subscription';
  } | null>;
}
```

Add:

```ts
async callWithUserProvider(task: StageTask, userId: string): Promise<ProviderResult> {
  const selected = await this.databaseOAuthCredentialsStore?.getActiveApiKey(userId);
  if (!selected) throw new Error('No active OAuth connection found for user');
  return this.piAdapter.call({
    provider: selected.provider,
    resultProvider: selected.resultProvider,
    model: selected.provider === 'openai-codex'
      ? this.env.HANDCLIP_CODEX_MODEL || 'gpt-5.3-codex'
      : this.env.HANDCLIP_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    apiKey: selected.apiKey,
    task,
  });
}
```

Keep existing `callWithFallback` for CLI spike.

- [ ] **Step 4: Forward `userId` through workers**

Update payload types:

```ts
interface TranscriptionJobData { projectId: string; userId: string; videoUrl: string; }
interface ClipAnalysisJobData { projectId: string; userId: string; videoUrl: string; transcriptionSegments?: SubtitleSegment[]; }
```

Forward `userId` when transcription enqueues analysis.

Instantiate DB store from worker service-role Supabase client and encryption key in
`ClipAnalysisProcessor`. Replace global use with instance field:

```ts
private readonly providerManager: ProviderManager;

constructor(
  private readonly supabaseService: SupabaseService,
  config: ConfigService,
) {
  super();
  const databaseStore = new DatabaseOAuthCredentialsStore(
    supabaseService.getServiceRoleClient(),
    config.getOrThrow<string>('AI_CONNECTIONS_ENCRYPTION_KEY'),
  );
  this.providerManager = new ProviderManager({ databaseOAuthCredentialsStore: databaseStore });
}
```

Use:

```ts
const result = await this.providerManager.callWithUserProvider(task, userId);
```

- [ ] **Step 5: Run worker verification**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/worker test
pnpm --filter @handclip/worker type-check
```

Expected: PASS.

- [ ] **Step 6: Commit worker user selection**

```powershell
git add handclip-backend/apps/worker/src
git commit -m "feat(worker): analyze clips with active user subscription"
```

## Task 9: Add Mobile API Client and Settings Tab

**Files:**
- Modify: `handclip-app/services/api.ts`
- Modify: `handclip-app/app/(tabs)/_layout.tsx`
- Create: `handclip-app/app/(tabs)/settings.tsx`

- [ ] **Step 1: Add mobile connection contract**

In `services/api.ts` add:

```ts
export type AiProvider = 'openai-codex' | 'anthropic';
export interface AiConnection { provider: AiProvider; isActive: boolean; connectedAt: string; }
export interface OAuthAttempt {
  id: string;
  provider: AiProvider;
  status: 'initializing' | 'awaiting-user' | 'connected' | 'failed' | 'expired';
  authorizationUrl?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresAt: string;
  error?: string;
}
```

Add generic `patch` and `del` helpers with `authHeaders()`. Add:

```ts
getAiConnections: () => get<AiConnection[]>('/ai-connections'),
startAiConnection: (provider: AiProvider) => post<OAuthAttempt>(`/ai-connections/${provider}/start`, {}),
getAiConnectionAttempt: (provider: AiProvider, id: string) =>
  get<OAuthAttempt>(`/ai-connections/${provider}/attempts/${id}`),
submitAiConnectionInput: (provider: AiProvider, id: string, input: string) =>
  post<OAuthAttempt>(`/ai-connections/${provider}/attempts/${id}/input`, { input }),
setActiveAiConnection: (provider: AiProvider) =>
  patch<void>('/ai-connections/active', { provider }),
disconnectAiConnection: (provider: AiProvider) =>
  del<void>(`/ai-connections/${provider}`),
```

- [ ] **Step 2: Add settings tab**

Add screen registration:

```tsx
<Tabs.Screen
  name="settings"
  options={{
    title: 'Configuracion',
    tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
  }}
/>
```

Create `settings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, AiConnection, AiProvider, OAuthAttempt } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function SettingsTab() {
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [connections, setConnections] = useState<AiConnection[]>([]);
  const [attempt, setAttempt] = useState<OAuthAttempt | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = async () => setConnections(await api.getAiConnections());

  useEffect(() => {
    if (isAuthenticated) refresh().catch((e: Error) => setError(e.message));
  }, [isAuthenticated]);

  const waitFor = async (provider: AiProvider, id: string, wanted: OAuthAttempt['status'][]) => {
    for (let count = 0; count < 120; count++) {
      const next = await api.getAiConnectionAttempt(provider, id);
      setAttempt(next);
      if (wanted.includes(next.status) || next.status === 'failed' || next.status === 'expired') return next;
      await sleep(1000);
    }
    throw new Error('OAuth attempt timed out');
  };

  const connect = async (provider: AiProvider) => {
    setLoading(true);
    setError('');
    try {
      const started = await api.startAiConnection(provider);
      setAttempt(started);
      const ready = await waitFor(provider, started.id, ['awaiting-user', 'connected']);
      const url = ready.verificationUri || ready.authorizationUrl;
      if (url) await WebBrowser.openBrowserAsync(url);
      if (provider === 'openai-codex') {
        const done = await waitFor(provider, started.id, ['connected']);
        if (done.status !== 'connected') throw new Error(done.error || 'OAuth failed');
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OAuth failed');
    } finally {
      setLoading(false);
    }
  };

  const submitAnthropic = async () => {
    if (!attempt || attempt.provider !== 'anthropic') return;
    setLoading(true);
    try {
      await api.submitAiConnectionInput('anthropic', attempt.id, manualInput);
      const done = await waitFor('anthropic', attempt.id, ['connected']);
      if (done.status !== 'connected') throw new Error(done.error || 'OAuth failed');
      setManualInput('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OAuth failed');
    } finally {
      setLoading(false);
    }
  };

  if (isAnonymous || !isAuthenticated) {
    return (
      <View>
        <Text>Modo exploracion</Text>
        <Text>Crea una cuenta para conectar Codex o Anthropic.</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/login')}>
          <Text>Crear cuenta o iniciar sesion</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <Text>Configuracion IA</Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {loading ? <ActivityIndicator accessibilityLabel="Procesando conexion" /> : null}
      {(['openai-codex', 'anthropic'] as AiProvider[]).map((provider) => {
        const connection = connections.find((item) => item.provider === provider);
        return (
          <View key={provider}>
            <Text>{provider === 'openai-codex' ? 'ChatGPT Plus/Pro (Codex)' : 'Anthropic Claude Pro/Max'}</Text>
            {provider === 'anthropic' ? <Text>Puede consumir extra usage facturado.</Text> : null}
            <Text>{connection ? (connection.isActive ? 'Activo' : 'Conectado') : 'Desconectado'}</Text>
            {!connection ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => connect(provider)}>
                <Text>Conectar</Text>
              </TouchableOpacity>
            ) : (
              <>
                {!connection.isActive ? (
                  <TouchableOpacity accessibilityRole="button" onPress={() => api.setActiveAiConnection(provider).then(refresh)}>
                    <Text>Usar para analisis</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity accessibilityRole="button" onPress={() => api.disconnectAiConnection(provider).then(refresh)}>
                  <Text>Desconectar</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );
      })}
      {attempt?.provider === 'openai-codex' && attempt.userCode ? <Text>Codigo: {attempt.userCode}</Text> : null}
      {attempt?.provider === 'anthropic' && attempt.status === 'awaiting-user' ? (
        <View>
          <TextInput value={manualInput} onChangeText={setManualInput} placeholder="Pega codigo o URL final" />
          <TouchableOpacity accessibilityRole="button" onPress={submitAnthropic}><Text>Confirmar codigo</Text></TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
```

During implementation apply existing app visual styles around this behavior. Keep same
state transitions and accessibility roles.

- [ ] **Step 3: Compile mobile**

Run:

```powershell
cd handclip-app
pnpm exec tsc --noEmit
```

Expected: PASS after reconciling pre-existing API client mismatches encountered in baseline.

- [ ] **Step 4: Commit settings UI**

```powershell
git add handclip-app/services/api.ts handclip-app/app/\(tabs\)/_layout.tsx handclip-app/app/\(tabs\)/settings.tsx
git commit -m "feat(app): add ai provider settings tab"
```

## Task 10: Add Anonymous Gates and Repair Import Contract

**Files:**
- Create: `handclip-app/lib/account-required.ts`
- Modify: `handclip-app/app/(tabs)/home.tsx`
- Modify: `handclip-app/app/import/index.tsx`
- Modify: `handclip-app/app/import/processing.tsx`
- Modify: `handclip-app/app/project/[id]/edit.tsx`
- Modify: `handclip-app/services/api.ts`

- [ ] **Step 1: Add shared anonymous modal helper**

Create:

```ts
import { Alert } from 'react-native';
import { router } from 'expo-router';

export function showAccountRequired(): void {
  Alert.alert(
    'Cuenta requerida',
    'Necesitas una cuenta para usar analisis IA y guardar proyectos.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Iniciar sesion', onPress: () => router.push('/login') },
      { text: 'Crear cuenta', onPress: () => router.push('/signup') },
    ],
  );
}
```

- [ ] **Step 2: Gate anonymous remote list and import**

In `home.tsx`, skip `api.getProjects()` for anonymous mode and show exploration empty
state. Import button still opens picker.

In `import/index.tsx`, allow selection and local validation, then:

```ts
if (isAnonymous || !isAuthenticated) {
  showAccountRequired();
  return;
}
```

Place gate immediately before upload.

- [ ] **Step 3: Gate analysis and export**

In `import/processing.tsx`, route missing active connection failures toward
`/(tabs)/settings`.

In `project/[id]/edit.tsx`, call `showAccountRequired()` before backend export if
anonymous.

- [ ] **Step 4: Repair mobile import API contract**

Current import screen calls missing client methods. Add exact methods matching existing
API:

```ts
uploadVideoFile: async (file: { uri: string; fileName: string; mimeType: string; fileSize: number }) => {
  const form = new FormData();
  form.append('video', { uri: file.uri, name: file.fileName, type: file.mimeType } as any);
  form.append('name', file.fileName.replace(/\.[^/.]+$/, ''));
  return post<{ projectId: string; videoUrl: string }>('/projects/upload', form, true);
},
```

Simplify `import/index.tsx`: use returned `projectId` and `videoUrl`; remove second
`createProject` call.

- [ ] **Step 5: Compile mobile**

Run:

```powershell
cd handclip-app
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit gates**

```powershell
git add handclip-app
git commit -m "feat(app): gate remote actions behind account"
```

## Task 11: Wire Environment and Local Documentation

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `handclip-backend/apps/api/.env.example`
- Modify: `handclip-backend/apps/worker/.env.example`
- Modify: `handclip-app/.env.example`
- Modify: `docs/handclip/local-subscription-oauth.md`

- [ ] **Step 1: Add encryption environment**

Add to root, API, worker examples:

```env
AI_CONNECTIONS_ENCRYPTION_KEY=replace_with_base64_encoded_32_byte_secret
```

Generate local value:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Put generated value in local `.env`, never commit actual secret.

- [ ] **Step 2: Pass encryption key to containers**

In `docker-compose.yml`, add under API and worker:

```yaml
- AI_CONNECTIONS_ENCRYPTION_KEY=${AI_CONNECTIONS_ENCRYPTION_KEY}
```

- [ ] **Step 3: Correct mobile example key**

Ensure `handclip-app/.env.example` uses:

```env
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

- [ ] **Step 4: Extend local OAuth docs**

Document:

- Apply SQL migration in Supabase.
- Configure encryption key.
- CLI flow remains optional spike path.
- Mobile flow requires registered Supabase user.
- Anonymous mode cannot upload, analyze, persist, or export.
- Codex uses device code.
- Anthropic requires pasted code or redirect URL.

- [ ] **Step 5: Validate compose**

Run:

```powershell
docker compose config --quiet
```

Expected: exit code `0`.

- [ ] **Step 6: Commit environment docs**

```powershell
git add .env.example docker-compose.yml handclip-backend/apps/api/.env.example handclip-backend/apps/worker/.env.example handclip-app/.env.example docs/handclip/local-subscription-oauth.md
git commit -m "docs: configure mobile subscription oauth locally"
```

## Task 12: Apply Migration and Run End-to-End Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Apply migration**

Run SQL additions from `docs/handclip/schemas/supabase-migration.sql` in Supabase SQL
Editor.

Expected: table `public.ai_provider_connections` and partial unique index exist.

- [ ] **Step 2: Run automated verification**

Run:

```powershell
cd handclip-backend
pnpm --filter @handclip/shared test
pnpm --filter @handclip/api test
pnpm --filter @handclip/worker test
pnpm run build
pnpm --filter @handclip/api type-check
pnpm --filter @handclip/worker type-check
cd ../handclip-app
pnpm exec tsc --noEmit
cd ..
docker compose config --quiet
docker compose build api worker
```

Expected: all commands PASS.

- [ ] **Step 3: Start services**

Run:

```powershell
docker compose up redis api worker
```

Expected: API health responds healthy and worker reports running.

- [ ] **Step 4: Test anonymous gate**

In app:

1. Tap `Continuar Anonimamente`.
2. Open `Configuracion`; verify provider actions disabled.
3. Select local video; verify account-required modal appears before upload.

- [ ] **Step 5: Test Codex mobile flow**

In app:

1. Register or sign in.
2. Open `Configuracion`.
3. Connect Codex.
4. Complete device-code browser flow.
5. Select Codex active.
6. Import video and analyze.

Expected worker log:

```text
[ClipAnalysis] Received response from openai-codex
```

- [ ] **Step 6: Test Anthropic mobile flow**

In app:

1. Connect Anthropic.
2. Complete browser flow.
3. Paste authorization code or final redirect URL.
4. Select Anthropic active.
5. Import video and analyze.

Expected worker log:

```text
[ClipAnalysis] Received response from anthropic-subscription
```

- [ ] **Step 7: Verify restart persistence and disconnect**

Restart API and worker:

```powershell
docker compose restart api worker
```

Expected: connected metadata persists. Disconnect active provider in app. Analysis
blocks until another connected provider becomes active.

- [ ] **Step 8: Review git scope**

Run:

```powershell
git status --short
git log --oneline --decorate -12
```

Expected: no secrets, no `db-pass.txt`, no OAuth token files staged or committed.
