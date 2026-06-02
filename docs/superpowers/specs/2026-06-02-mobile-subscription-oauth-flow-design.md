# Mobile Subscription OAuth Flow

## Goal

Add app-testable AI provider connections for registered HandClip users. Users connect a
ChatGPT Plus/Pro Codex subscription or an Anthropic Claude Pro/Max subscription from
the mobile app. Clip analysis uses the selected subscription. OAuth tokens never enter
mobile storage or logs.

## Scope

Included:

- New mobile `Configuracion` tab.
- Anonymous exploration mode with remote actions blocked.
- Supabase Bearer authentication for AI connection endpoints.
- Encrypted OAuth credential persistence per Supabase user.
- Codex device-code login.
- Anthropic authorization URL plus manual code or redirect URL paste.
- Manual active-provider selector.
- Worker credential lookup, token refresh persistence, and provider selection per user.
- SQL migration, environment variables, automated tests, and local verification docs.

Excluded:

- Redis persistence for in-flight OAuth attempts.
- Admin panel.
- HandClip-managed API-key quota.
- Migration of anonymous local projects into registered accounts.
- Advanced billing UI.

## Anonymous Mode

`Continuar Anonimamente` remains a local exploration path. It does not create a
Supabase user.

Anonymous users may:

- Enter the app.
- Navigate screens.
- Import a local video for UI exploration.
- Explore editor surfaces with local or demo data.

Anonymous users may not:

- Connect Codex or Anthropic.
- Upload videos to Supabase.
- Persist remote projects.
- Start AI analysis.
- Request backend exports.

Blocked actions show a modal:

> Necesitas una cuenta para usar analisis IA y guardar proyectos.

Actions:

- `Crear cuenta`
- `Iniciar sesion`
- `Cancelar`

## Mobile UI

Add a third tab: `Configuracion`.

Anonymous state:

- Show exploration-mode explanation.
- Disable provider connection actions.
- Show `Crear cuenta o iniciar sesion`.

Registered state:

- Show cards for `ChatGPT Plus/Pro (Codex)` and `Anthropic Claude Pro/Max`.
- Each card shows disconnected, connecting, connected, or failed state.
- Each card offers connect or disconnect.
- Connected providers may be chosen as active provider.
- Anthropic card warns that third-party use may consume billed extra usage.

Analysis entry points verify:

1. User has real Supabase session.
2. User has active provider connection.

If either condition fails, block analysis and route user toward login or
`Configuracion`.

## OAuth Flows

### Codex

Use `loginOpenAICodexDeviceCode` from `@earendil-works/pi-ai/oauth`.

1. App requests a Codex attempt.
2. API starts login asynchronously.
3. API returns attempt metadata after `onDeviceCode`: verification URL, user code,
   expiry, and polling interval.
4. App displays code and opens browser.
5. API completes provider polling and stores encrypted credentials.
6. App polls attempt status until connected, failed, cancelled, or expired.

### Anthropic

Use `loginAnthropic` from `@earendil-works/pi-ai/oauth`.

1. App requests an Anthropic attempt.
2. API starts login asynchronously.
3. API returns authorization URL after `onAuth`.
4. App opens browser and displays a field for pasted authorization code or final
   redirect URL.
5. App submits manual input to API.
6. API exchanges code and stores encrypted credentials.
7. App polls attempt status until connected, failed, cancelled, or expired.

`pi-ai` starts a local callback server for Anthropic. Manual input remains the required
mobile-safe path because phone browser cannot reliably reach backend localhost.

## API Module

Add Nest module `ai-connections`.

Endpoints:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/ai-connections` | List connection metadata and active provider |
| `POST` | `/api/ai-connections/:provider/start` | Start OAuth attempt |
| `GET` | `/api/ai-connections/:provider/attempts/:attemptId` | Read attempt state |
| `POST` | `/api/ai-connections/:provider/attempts/:attemptId/input` | Submit manual OAuth input |
| `PATCH` | `/api/ai-connections/active` | Set active connected provider |
| `DELETE` | `/api/ai-connections/:provider` | Disconnect provider |

Allowed provider route values:

- `openai-codex`
- `anthropic`

API responses expose metadata only. Never expose access token, refresh token,
ciphertext, IV, or authentication tag.

## Authentication

Add Bearer-token user resolution for AI connection endpoints:

1. Read `Authorization: Bearer <token>`.
2. Resolve user through Supabase `auth.getUser(token)`.
3. Reject missing or invalid tokens with `401`.

This focused change protects new endpoints. Existing API-wide authentication gaps
remain separate work. Analysis entry points must also require resolved Supabase user
before queueing work, because subscription credential selection depends on a real
owner.

## Data Model

Add `public.ai_provider_connections`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | FK to `profiles(id)`, cascade delete |
| `provider` | `text` | `openai-codex` or `anthropic` |
| `credentials_ciphertext` | `text` | AES-256-GCM encrypted JSON |
| `credentials_iv` | `text` | Base64 IV |
| `credentials_tag` | `text` | Base64 authentication tag |
| `is_active` | `boolean` | User-selected analysis provider |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Default `now()` |

Constraints:

- Unique `(user_id, provider)`.
- Partial unique index for one active connection per user.
- Provider check constraint.
- RLS enabled.
- No client policy grants ciphertext access. API and worker use service role.

## Encryption

Add shared server-only credential encryption utility:

- Algorithm: AES-256-GCM.
- Key: `AI_CONNECTIONS_ENCRYPTION_KEY`.
- Key representation: base64 encoded 32-byte secret.
- Generate random 12-byte IV per write.
- Serialize OAuth credentials as JSON before encryption.
- Validate key length at service startup.

API and worker receive same secret through environment configuration.

## In-Flight Attempt Store

Store attempts in API process memory for MVP local testing.

Each attempt records:

- Random attempt ID.
- Supabase user ID.
- Provider.
- State: pending initialization, awaiting user, connected, failed, cancelled, or
  expired.
- Public prompt metadata.
- Optional pending manual-input resolver.
- Sanitized error message.
- Expiration timestamp.

Rules:

- Attempts belong to requesting user.
- Expire automatically.
- Never include OAuth credentials in status responses.
- API restart cancels pending attempts but preserves completed encrypted connections.

Redis persistence is deferred.

## Worker Flow

Analysis jobs carry `userId` from authenticated API request.

Before clip analysis:

1. Load active connection for `userId` with service role.
2. Decrypt stored credentials.
3. Call `getOAuthApiKey(provider, credentials)` through `pi-ai`.
4. If refresh changed credentials, encrypt and persist new value.
5. Map stored `anthropic` connection to existing result provider
   `anthropic-subscription`.
6. Execute clip analysis with existing `PiProviderAdapter`.

Missing active connection fails analysis with a clear error. App-connected analysis
does not silently use server API-key fallback. Whisper transcription remains separate
and still uses `OPENAI_API_KEY`.

Existing local CLI credential file remains supported as a developer spike path, not
as mobile-user storage.

## Job Ownership

Update authenticated analysis endpoint:

1. Resolve Supabase user from Bearer token.
2. Verify requested project belongs to that user.
3. Queue transcription with `userId`.
4. Transcription forwards `userId` to clip-analysis job.
5. Clip-analysis resolves active OAuth connection for that exact user.

This also prevents one user from analyzing another user's project.

## Error Handling

Mobile displays actionable messages for:

- Backend unreachable.
- Missing login.
- Missing active provider.
- OAuth cancelled.
- OAuth attempt expired.
- Invalid Anthropic code or redirect URL.
- Token refresh failure.
- Provider request failure.

Backend logs provider and attempt IDs where useful. Backend never logs tokens,
ciphertext, pasted authorization code, or redirect URL query values.

## Environment

Add:

```env
AI_CONNECTIONS_ENCRYPTION_KEY=<base64-encoded-32-byte-secret>
HANDCLIP_LLM_ALLOW_API_KEY_FALLBACK=false
```

Pass encryption key to API and worker containers.

Correct mobile example variable:

```env
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Testing

Automated:

- API Bearer auth guard: valid, missing, invalid token.
- AES-256-GCM utility: roundtrip, wrong key, malformed payload.
- Connection service: metadata list, encrypted upsert, active selection, disconnect.
- Attempt manager: Codex device metadata, Anthropic manual input, expiration, user
  isolation, sanitized failures.
- Analysis queue: reject anonymous user, reject foreign project, forward `userId`.
- Worker resolver: active provider selection, missing connection, token refresh write,
  Codex and Anthropic provider mapping.
- Mobile API client TypeScript coverage where existing harness permits.
- Mobile TypeScript compilation and navigation smoke verification.

Manual:

1. Enter anonymous mode and verify remote actions block with account CTA.
2. Register or sign in with Supabase user.
3. Connect Codex with device code.
4. Import and analyze video; confirm worker logs `openai-codex`.
5. Connect Anthropic with pasted code or redirect URL.
6. Select Anthropic as active.
7. Analyze video; confirm worker logs `anthropic-subscription`.
8. Restart API and worker; confirm completed connections remain available.
9. Disconnect provider; confirm analysis blocks when no active provider remains.

## Migration Strategy

Apply additive SQL migration before testing UI. Existing local OAuth CLI behavior
continues working. Mobile OAuth uses database-backed credentials only. Remove no
existing provider paths during this phase.
