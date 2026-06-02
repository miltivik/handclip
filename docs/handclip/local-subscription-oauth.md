# OAuth local para análisis de clips

Spike local. Usa suscripción ChatGPT Plus/Pro o Claude Pro/Max solo para análisis LLM.
Transcripción Whisper sigue usando `OPENAI_API_KEY`.

## Preparación

Desde `handclip-backend`:

```powershell
pnpm install
pnpm --filter @handclip/worker oauth:login:codex
pnpm --filter @handclip/worker oauth:login:anthropic
```

Cada login actualiza `apps/worker/.local/auth.json`. Archivo ignorado por git. Docker monta
directorio `.local` read-write para persistir refresh de tokens.

## Flujo móvil (fase 2)

Usuarios registrados Supabase pueden conectar Codex o Anthropic desde la app,
en la pestaña **Configuracion**. Las credenciales OAuth se guardan cifradas
AES-256-GCM en `public.ai_provider_connections` con clave por usuario. La app
muestra solo metadatos (proveedor, is_active, fecha de conexion). Nunca expone
tokens, IV, tag ni ciphertext.

### Codex

Login con device code:

1. Abre Configuracion y toca "Conectar" en ChatGPT Plus/Pro (Codex).
2. La app muestra el codigo de verificacion y abre el navegador automaticamente.
3. El worker resuelve el polling de `pi-ai` y cifra los tokens.

### Anthropic

Login manual:

1. Abre Configuracion y toca "Conectar" en Anthropic Claude Pro/Max.
2. La app abre la URL de autorizacion en el navegador.
3. Despues de aceptar, pega el codigo `code#state` o la URL final de redireccion.
4. El API intercambia el codigo y cifra los tokens.

`pi-ai` intenta levantar un callback server local para Anthropic. En el flujo
movil eso no es fiable, por lo que el pegado manual es la ruta esperada.

## Selección

Configurar `.env` raíz antes de levantar Docker:

```env
AI_CONNECTIONS_ENCRYPTION_KEY=<base64-encoded-32-byte-secret>
HANDCLIP_LLM_PROVIDER=api-key
HANDCLIP_LLM_ALLOW_API_KEY_FALLBACK=false
HANDCLIP_CODEX_MODEL=gpt-5.3-codex
HANDCLIP_ANTHROPIC_MODEL=claude-sonnet-4-6
```

Generar la clave (PowerShell):

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

API y worker deben compartir el mismo `AI_CONNECTIONS_ENCRYPTION_KEY`.
`HANDCLIP_LLM_ALLOW_API_KEY_FALLBACK=false` evita que el worker use API keys
anonimas cuando un usuario registrado no tiene proveedor activo.

Valores válidos de `HANDCLIP_LLM_PROVIDER`:

```text
api-key
openai-codex
anthropic-subscription
```

`api-key` conserva fallback OpenAI, Anthropic y OpenRouter configurados por variables existentes.
Anthropic API-key usa API nativa mediante `pi-ai`.

## Migración

Antes de iniciar la app, aplica la seccion `ai_provider_connections` del
archivo `docs/handclip/schemas/supabase-migration.sql` en Supabase SQL Editor.

## Modo anónimo

La opcion **Continuar Anonimamente** abre un modo local sin cuenta Supabase.
Permite navegar, importar video local y explorar la UI. Bloquea:

- Conexion OAuth a Codex o Anthropic.
- Subida de videos a Supabase.
- Analisis IA.
- Persistencia remota.
- Export backend.

Cualquier intento de accion remota abre un modal con **Crear cuenta**, **Iniciar
sesion** y **Cancelar**.

## Ejecución

Desde raíz repo:

```powershell
docker compose up --build redis api worker
docker compose logs -f worker
```

Importar video. Verificar log:

```text
[ClipAnalysis] Received response from openai-codex (...)
```

o:

```text
[ClipAnalysis] Received response from anthropic-subscription (...)
```

Nunca versionar ni imprimir `apps/worker/.local/auth.json`.

## Límites

- Credenciales moviles se almacenan cifradas en Supabase; la CLI local
  (`apps/worker/.local/auth.json`) sigue siendo valida para desarrollo.
- Claude Pro/Max desde integraciones terceras puede consumir `extra usage` facturado.
- `OPENAI_API_KEY` sigue requerido por Whisper aunque análisis use OAuth.
