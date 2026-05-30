# HandClip — Plan de Producto y Arquitectura Técnica

> **Versión:** 1.0 — MVP
> **Fecha:** 2026-05-28
> **Stack objetivo:** Expo (React Native) + NestJS + Supabase + BullMQ/Redis + FFmpeg + Remotion

---

## 1. Definición del Producto

HandClip es una herramienta **mobile-first** para creadores de contenido que convierte videos largos en clips cortos candidatos para redes sociales.

La promesa es **identificar y editar clips con potencial** a partir de un video fuente, no generar clips perfectos listos para publicar. El usuario recibe clips marcados como candidatos; él decide cuáles exportar y personaliza los ajustes finales.

### Core features

- **Clip Finder:** Detecta automáticamente segmentos con alta energía, cortes limpios, discurso claro o movimiento. Devuelve clips candidatos con puntuación de potencial.
- **Quick Edit:** Recorta, ajusta subtítulos y aplica formato vertical 9:16 sobre los candidatos seleccionados. Exporta el resultado final.

### Lo que NO es

- Editor profesional de video.
- Generador de contenido desde cero.
- Plataforma de distribución o programación social.
- Biblioteca musical o B-roll propio.

---

## 2. Propuesta de MVP

El MVP resuelve un solo problema: **tienes un video largo y quieres encontrar y exportar sus mejores momentos en formato vertical, rápido.**

### Scope del MVP

- Importar un video desde galería.
- Detectar hasta 10 clips candidatos ordenados por puntuación.
- Seleccionar y previsualizar candidatos.
- Quick Edit: trim, formato 9:16, subtítulos básicos (texto + posición).
- Exportar un clip a la vez (MP4/H.264, vertical).
- Una cuenta por usuario, sin equipo ni workspaces.

### Criterio de éxito del MVP

Un usuario puede importar un video de 10 minutos, encontrar 3 clips candidatos, añadir subtítulos, exportar uno y compartirlo. Tarea completable en menos de 5 minutos.

---

## 3. User Stories Principales

### Por rol: Creador de contenido

| ID | Historia | Prioridad | Pantalla MVP |
|----|----------|-----------|-------------|
| US-01 | Como creador, quiero importar un video desde mi galería para empezar a trabajar sin depender de una conexión de red | P0 | Import |
| US-02 | Como creador, quiero ver clips candidatos con puntuación de potencial para decidir cuáles revisar primero | P0 | Candidates |
| US-03 | Como creador, quiero previsualizar un clip candidato antes de editarlo para evitar invertir tiempo en clips que no funcionan | P0 | Preview |
| US-04 | Como creador, quiero recortar el inicio y fin de un clip con handles táctiles para ajustar el timing exacto | P0 | Edit |
| US-05 | Como creador, quiero que los subtítulos se generen automáticamente desde la transcripción para no tener que escribirlos manualmente | P0 | Edit |
| US-06 | Como creador, quiero corregir una palabra mal transcrita tocándola en pantalla para garantizar subtítulos precisos | P1 | Edit |
| US-07 | Como creador, quiero exportar el clip en formato vertical 9:16 para publicarlo directo en TikTok/Reels/Shorts | P0 | Export |
| US-08 | Como creador, quiero ver una barra de progreso durante el análisis IA para saber cuánto falta sin abandonar la app | P0 | Processing |
| US-09 | Como creador, quiero elegir qué clip exportar de entre los candidatos (sin que la IA decida por mí) para mantener control creativo | P0 | Candidates |
| US-10 | Como creador, quiero seleccionar un rango del video fuente manualmente si la IA no encuentra lo que busco para no depender 100% del análisis automático | P1 | Manual Select |

### Por rol: Sistema

| ID | Historia | Prioridad |
|----|----------|-----------|
| US-11 | Como sistema, debo validar el formato y tamaño del video al importar para rechazar archivos incompatibles antes de procesar | P0 |
| US-12 | Como sistema, debo transcribir el audio con word-level timestamps para alimentar subtítulos y análisis de contenido | P0 |
| US-13 | Como sistema, debo notificar al usuario cuando el render final esté listo (incluso si cerró la app) para garantizar que el clip no se pierda | P1 |
| US-14 | Como sistema, debo eliminar archivos temporales tras el procesamiento para no acumular storage innecesario | P1 |

---

## 4. Flujos de Usuario

### 4.1 Clip Finder — Flujo principal

```
[Pantalla Home] → [Importar video] → [Procesando...] → [Candidatos] → [Seleccionar clip]
                                                                          ↓
                                                              [Preview + Quick Edit]
```

**Pantallas del flujo:**

1. **Home / Empty State:** Botón prominente "Importar video". Si hay proyectos recientes, se muestran como tarjetas.
2. **Import:** Selector de galería nativo (`expo-image-picker`). Filtro: videos ≤ 2 GB, ≤ 30 min. Validación inmediata de formato.
3. **Processing:** Pantalla de progreso con etapas visibles:
   - "Transcribiendo audio..." (0-40%)
   - "Analizando contenido..." (40-70%)
   - "Generando candidatos..." (70-100%)
   - ETA estimado visible junto a cada etapa.
   - Sin razonamiento interno del modelo expuesto al usuario.
4. **Candidates:** Lista vertical de tarjetas. Cada tarjeta muestra:
   - Thumbnail del clip.
   - Puntuación de potencial (0-100).
   - Timestamp de inicio y duración.
   - Razones de selección (íconos: energía, emoción, punchline).
   - Botón "Editar" y "Previsualizar".

### 4.2 Quick Edit — Flujo de edición

```
[Candidato seleccionado] → [Editor 9:16]
                              ├── Trim (handles arrastrables 44×44pt)
                              ├── Subtítulos (toggle + edición táctil)
                              ├── Formato 9:16 asegurado
                              └── [Previsualizar] → [Exportar]
```

**Editor Quick Edit:**
- Vista previa 9:16 en la mitad superior.
- Timeline simplificado en la mitad inferior con handles de inicio/fin.
- Subtítulos superpuestos sobre el preview con toggle de visibilidad.
- Botón "Exportar" siempre visible (sticky bottom).
- Undo por operación (trim, caption edit, format change).
- Sin multi-pista ni transiciones complejas.

### 4.3 Corrección Manual — Flujo táctil

**Tres modos de edición táctil:**

1. **Arrastrar handles de trim:** Dedos sobre los extremos del timeline para ajustar in/out points. Snap a 0.1s.
2. **Pinch para zoom en timeline:** Acercar/alejar para precisión en clips largos.
3. **Tap en subtítulo:** Abre editor inline con el texto. El teclado ocupa el tercio inferior. Corrección confirmada con "Listo".

**Referencias temporales:**
- Los timestamps se generan por selección en el timeline, no por escritura manual.
- El usuario toca un punto en el timeline y la app muestra el tiempo exacto.
- Campos numéricos disponibles como alternativa avanzada (ocultos por defecto).

### 4.4 Progreso Visible y Plan Editable

**Indicadores de progreso IA:**
- Barra de progreso determinística con porcentaje y ETA por etapa.
- Estados intermedios visibles: "Transcribiendo (audio 60%)", "Analizando patrones de energía...", "Generando 7 clips candidatos...".
- Si el proceso excede 3 minutos, se muestra opción de "Notificarme cuando termine".

**Plan editable:**
- Tras el análisis, el usuario ve la lista de acciones sugeridas agrupadas por clip.
- Cada acción tiene toggle de aceptar/rechazar.
- El usuario puede modificar cualquier parámetro antes de confirmar.

---

## 5. Arquitectura Técnica

### 5.1 Stack y Diagrama General

```
┌──────────────────────────────────────────────────────────┐
│  CLIENTE (Expo / React Native)                           │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────────────┐   │
│  │ Auth Store  │ │ Zustand  │ │ expo-video / picker  │   │
│  │ (Zustand)   │ │ stores   │ │ (playback + import)  │   │
│  └─────────────┘ └──────────┘ └──────────────────────┘   │
└──────────────────────┬───────────────────────────────────┘
                       │ REST + SSE (job progress)
┌──────────────────────▼───────────────────────────────────┐
│  API GATEWAY (NestJS — apps/api)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Auth     │ │ Projects │ │ Clips    │ │ Jobs/Export│  │
│  │ Module   │ │ Module   │ │ Module   │ │ Module     │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  WORKER (NestJS — apps/worker)                           │
│  ┌──────────────┐ ┌────────────────┐ ┌───────────────┐   │
│  │ Transcription│ │ Clip Analysis  │ │ Render/Export │   │
│  │ (Whisper)    │ │ (LLM Provider) │ │ (FFmpeg)      │   │
│  └──────────────┘ └────────────────┘ └───────────────┘   │
│                     BullMQ + Redis                       │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  INFRAESTRUCTURA                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Supabase │ │ Redis    │ │ S3/R2    │ │ Vercel /   │  │
│  │ (PG+Auth)│ │ (BullMQ) │ │ (Storage)│ │ Railway    │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Separación API / Worker

- **API (apps/api):** Maneja autenticación, CRUD de proyectos/clips, retorna estado de jobs, sirve SSE para progreso.
- **Worker (apps/worker):** Procesa jobs de BullMQ: transcripción, análisis LLM, render con FFmpeg. Stateless, escalable horizontalmente.
- **Comunicación:** API encola jobs en BullMQ. Worker actualiza progreso vía `job.updateProgress()`. API emite eventos SSE al cliente con el progreso.

---

## 6. Estructura de Base de Datos Inicial (Supabase Postgres)

### 6.1 Tablas

#### `profiles`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | Vinculado a `auth.users.id` |
| `display_name` | TEXT | Nombre visible |
| `avatar_url` | TEXT | URL de avatar en Storage |
| `plan` | TEXT | 'free' | 'pro' |
| `exports_this_month` | INT | Contador de exports del mes |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `projects`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `user_id` | UUID FK → profiles | Dueño |
| `title` | TEXT | Título opcional |
| `source_video_url` | TEXT | URL en bucket `source-videos` |
| `source_duration` | FLOAT | Duración del video fuente (segundos) |
| `status` | TEXT | 'uploading' | 'processing' | 'ready' | 'failed' |
| `timeline` | JSONB | Timeline de edición |
| `metadata` | JSONB | Resolución, fps, códec, etc. |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `clips`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `project_id` | UUID FK → projects | |
| `start_time` | FLOAT | Inicio en segundos |
| `end_time` | FLOAT | Fin en segundos |
| `confidence_score` | INT | 0-100 |
| `reasons` | JSONB | Array de razones de detección |
| `suggested_caption` | TEXT | |
| `transcript_snippet` | TEXT | |
| `mood_tags` | JSONB | Array de tags emocionales |
| `status` | TEXT | 'candidate' | 'selected' | 'edited' | 'exported' |
| `user_edited` | BOOL | false por defecto |
| `created_at` | TIMESTAMPTZ | |

#### `subtitles`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `project_id` | UUID FK → projects | |
| `clip_id` | UUID FK → clips (nullable) | |
| `segments` | JSONB | Array de SubtitleSegment con word-level timestamps |
| `language` | TEXT | ISO 639-1 |
| `created_at` | TIMESTAMPTZ | |

#### `exports`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `project_id` | UUID FK → projects | |
| `clip_id` | UUID FK → clips | |
| `preset` | TEXT | 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq' |
| `status` | TEXT | 'queued' | 'rendering' | 'completed' | 'failed' |
| `output_url` | TEXT | URL del archivo final en bucket `exports` |
| `file_size` | BIGINT | Bytes |
| `duration` | FLOAT | Duración final |
| `created_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | |

#### `jobs`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `project_id` | UUID FK → projects | |
| `type` | TEXT | 'transcription' | 'clip_analysis' | 'render' |
| `status` | TEXT | 'queued' | 'active' | 'completed' | 'failed' |
| `progress` | INT | 0-100 |
| `result` | JSONB | Resultado del job (o error) |
| `bullmq_id` | TEXT | ID del job en BullMQ |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### 6.2 RLS / Auth / Storage

**Row Level Security:**
- `profiles`: Usuarios leen su propio perfil. Admin lee todos (futuro).
- `projects`, `clips`, `subtitles`, `exports`, `jobs`: Solo el `user_id` dueño accede.
- Políticas: `USING (auth.uid() = user_id)` para SELECT/UPDATE/DELETE.

**Auth:**
- Supabase Auth con magic link (MVP) + Google OAuth.
- `expo-auth-session` para OAuth en mobile.
- Sesión persistente vía `@supabase/ssr`.

**Storage (3 buckets):**
| Bucket | Propósito | Lifecycle |
|--------|-----------|-----------|
| `source-videos` | Videos subidos por usuarios | Delete tras 7 días |
| `exports` | Clips renderizados finales | Delete tras 30 días |
| `thumbnails` | Thumbnails de clips candidatos | Delete tras 24h |

---

## 7. Módulos Backend

### 7.1 MVP

| Módulo | Responsabilidad |
|--------|----------------|
| **Auth** | Registro, login (magic link + Google OAuth), refresh de sesión |
| **Projects** | CRUD de proyectos, metadata del video fuente |
| **Uploads** | Chunked upload a Supabase Storage, validación de formato/tamaño |
| **Clips** | CRUD de clips candidatos, scoring, selección/rechazo |
| **Jobs** | Encolar trabajos en BullMQ, retornar estado/progreso al cliente |
| **Export** | Iniciar render, notificar completitud, servir URL de descarga |
| **Webhooks** | Callbacks de Supabase Storage y eventos de workers |
| **Health** | Healthcheck de API, worker, Redis, Supabase |

### 7.2 Post-MVP (V1+)

| Módulo | Cuándo |
|--------|--------|
| Billing | Beta — planes freemium/pro con Stripe |
| Teams | V1 — workspaces multi-usuario |
| Analytics | V1 — métricas de uso y calidad de clips |
| StockMedia | V1 — integración con Unsplash/Pexels para B-roll |
| Branding | V1 — logos, intros/outros personalizables |
| AIGeneration | V2 — solo si V1 demuestra tracción ($10K+ MRR) |

---

## 8. Estructura de Carpetas

### 8.1 Frontend (Expo + React Native)

```
handclip-app/
├── app/                          # Expo Router (file-based routing)
│   ├── _layout.tsx               # Root layout + providers
│   ├── index.tsx                 # Home / Empty State
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── home.tsx              # Proyectos recientes
│   │   └── library.tsx           # Clips exportados
│   ├── import/
│   │   └── index.tsx             # Selector de video + upload
│   ├── project/
│   │   └── [id]/
│   │       ├── index.tsx          # Pantalla de candidatos
│   │       ├── edit.tsx           # Quick Edit
│   │       └── export.tsx         # Pantalla de exportación
├── components/
│   ├── editor/
│   │   ├── Timeline.tsx           # Timeline simplificado con handles
│   │   ├── Preview.tsx            # VideoView 9:16
│   │   ├── SubtitleOverlay.tsx    # Overlay de subtítulos
│   │   └── TrimHandles.tsx        # Handles arrastrables
│   ├── clips/
│   │   ├── CandidateCard.tsx      # Tarjeta de clip candidato
│   │   └── ScoreBadge.tsx         # Badge de puntuación
│   └── ui/
│       ├── ProgressBar.tsx        # Barra de progreso IA
│       └── EmptyState.tsx         # Estado vacío
├── hooks/
│   ├── useVideoPlayer.ts          # Wrapper de expo-video
│   ├── useProject.ts             # Estado del proyecto actual
│   └── useJobProgress.ts         # Polling/SSE de progreso
├── stores/
│   ├── auth.store.ts             # Zustand auth
│   ├── project.store.ts          # Zustand proyecto activo
│   └── editor.store.ts           # Zustand estado de edición
├── services/
│   ├── api.ts                    # Cliente HTTP (fetch/axios)
│   ├── supabase.ts               # Cliente Supabase
│   └── sse.ts                    # EventSource para progreso
├── lib/
│   ├── constants.ts              # Presets, límites, URLs
│   └── validation.ts             # Validación de formatos/tamaños
└── app.json                      # Expo config
```

### 8.2 Backend (NestJS + Turborepo)

```
handclip-backend/
├── apps/
│   ├── api/                      # API Gateway NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── projects/
│   │   │       ├── clips/
│   │   │       ├── uploads/
│   │   │       ├── jobs/
│   │   │       ├── exports/
│   │   │       └── health/
│   │   └── tsconfig.json
│   └── worker/                   # Worker NestJS
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   └── processors/
│       │       ├── transcription.processor.ts
│       │       ├── clip-analysis.processor.ts
│       │       └── render.processor.ts
│       └── tsconfig.json
├── libs/
│   └── shared/                   # Tipos, DTOs, schemas compartidos
│       ├── src/
│       │   ├── dto/
│       │   ├── schemas/          # JSON Schemas (candidate-clip, edit-action, subtitle)
│       │   ├── types/
│       │   └── constants/
│       └── tsconfig.json
├── packages/
│   └── configs/                  # ESLint, Prettier, tsconfig base
├── turbo.json
└── package.json
```

---

## 9. Pipeline de Procesamiento de Video

### 9.1 Flujo Desde Upload Hasta Export Final

```
[Upload] → [Transcode entrada] → [Timeline Assembly] → [Preview Render] → [Final Export]
    ↓              ↓                     ↓                   ↓                ↓
 Upload API   Validation &       Build JSON timeline   Remotion (FAST)   FFmpeg (HQ)
 → S3 Raw    Normalize codec     → FFmpeg commands    → Serve preview   → S3 Final
```

**Etapas del pipeline:**

1. **Ingest / Upload:** Recepción vía chunked upload. Validación de formato: MP4, MOV, WEBM, M4V, MKV ≤ 500 MB (Prototype), ≤ 2 GB (MVP). Extracción de metadata. Guardado en bucket `source-videos`.
2. **Transcode de Entrada:** FFmpeg normaliza a codec intermedio: H.264 1080x1920 @ 30fps, audio AAC 48kHz stereo. Output: proxy de edición.
3. **Timeline Assembly:** Construcción de JSON Timeline desde el editor. Incluye: clips, duración, texto overlay, B-roll markers, audio tracks, velocidad.
4. **Preview Render:** Remotion consume timeline + proxy. Genera 720p preview para playback in-app (< 30s).
5. **Final Export:** FFmpeg ejecuta comandos desde el timeline: concatenar, overlays, texto, mezcla audio. Output en bucket `exports`.

### 9.2 Responsabilidades FFmpeg vs Remotion

| Responsabilidad | FFmpeg | Remotion |
|---|---|---|
| Transcode/normalización entrada | Si | No |
| Concatenación de clips | Si | Maneja clips sueltos |
| Overlays de texto (burned-in) | Si, complejo | Si, rápido |
| Transiciones animadas | No (blend simple) | Si (blur, zoom, fade, slide) |
| Preview rápido (< 30s) | Más lento | Si, React-based, hot reload |
| Export final HQ | Si, bitrate configurable | No es su fuerte |
| Mezcla de audio (voice + music) | Si | Limitado |
| Render en servidor (offline) | Standalone binary | Requiere Node runtime + licencia |

**Decisión MVP:**
- **Remotion:** preview render + prototype de transiciones en desarrollo. No para producción.
- **FFmpeg:** toda la lógica de producción. Se ejecuta en workers (no en dispositivo).

### 9.3 Generación de Preview Rápido y Render Final

**Preview rápido:**
- Trigger: cada vez que el usuario guarda cambios en el editor.
- Path: Remotion → `renderComposition()` a 720p.
- Tiempo objetivo: < 30s para video de 60s.
- Fallback: si Remotion falla → FFmpeg export 720p@1Mbps.

**Render final:**
- Trigger: botón "Exportar" del usuario.
- Path: Job Queue (BullMQ) → FFmpeg worker → S3 output.
- Tiempo objetivo: < 5min para 60s de clip.
- Notificación: polling `GET /api/projects/:id/jobs/:jobId` cada 5s.

### 9.4 Manejo de Música Importada

**Importación:** El usuario sube MP3, WAV, AAC desde su dispositivo. Validación: duración ≤ 5 min (MVP).

**Trim:** Definido en timeline (`audio.startTime`, `audio.duration`). FFmpeg: `-ss {start} -t {duration}`.

**Volumen:** Control deslizante UI: 0%–200%. FFmpeg: `volume={level}`. Presets: música al 30% por defecto cuando hay voz.

**Fade in/out:** FFmpeg: `afade=t=in:st=0:d=0.5,afade=t=out:st={end-0.5}:d=0.5`.

**Mezcla voz/música (ducking):** Voz = track principal. Música baja a 25% cuando detecta voz. Ducking simple con `silencedetect` en MVP.

### 9.5 Presets de Exportación

| Preset | Resolution | Bitrate Video | Bitrate Audio | FPS | Caso de uso |
|--------|------------|---------------|---------------|-----|-------------|
| TikTok/Reels/Shorts | 1080x1920 | 8 Mbps | 128 kbps AAC | 30 | Publicación directa |
| Draft Preview | 720x1280 | 2 Mbps | 96 kbps AAC | 30 | Revisión interna |
| High Quality | 1080x1920 | 20 Mbps | 256 kbps AAC | 30 | Master, re-export |

**Comando TikTok (default):**
```bash
ffmpeg -i input_proxy.mp4 \
  -c:v libx264 -preset fast -crf 18 -maxrate 8M -bufsize 16M \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1" \
  -c:a aac -b:a 128k -ar 48000 \
  -movflags +faststart output_tiktok.mp4
```

Advanced settings escondidos por defecto: CRF, preset FFmpeg, bitrate máximo, codec de salida, perfil de color.

### 9.6 Sugerencias de B-Roll como Marcadores Editables

Los marcadores se presentan en el timeline con preview thumbnail. El usuario puede aceptarlos, rechazarlos o reposicionarlos.

```
[Upload] → [FFmpeg frame extraction cada 1s] → [Scene detection] → [B-Roll markers]
```

**Estados del marcador:**

| Estado | Significado | UI |
|--------|-------------|----|
| `pending` | Sugerido por IA, sin decisión | Amarillo |
| `accepted` | Usuario lo aceptó, editable | Verde |
| `rejected` | Usuario lo rechazó | Rojo tachado |
| `replaced` | Usuario reemplazó con otro asset | Azul |

**Interacciones del usuario:** aceptar, rechazar, reemplazar (selector de assets), mover, resize. En MVP: 10 marcadores/proyecto, solo sugerencias (sin búsqueda externa de assets).

### 9.7 Puntos de Fallo y Reintentos

| Punto de fallo | Estrategia |
|----------------|------------|
| Upload corrupto | MD5 checksum + re-upload |
| FFmpeg transcode falla | Retry 3x con codec fallback (H.264 → H.265 → passthrough) |
| Remotion preview timeout | Fallback automático a FFmpeg 720p |
| FFmpeg export OOM | Retry con preset degradation (HQ → TikTok → Draft) |
| Cola de jobs llena | Exponential backoff + auto-scale workers |
| S3 upload lento | Retry 3x con exponential backoff, multi-part upload |

---

## 10. Pipeline de IA

```
Video Input (9:16 vertical, MP4/MOV)
  │
  ▼
┌─────────────────────────────────────────────────┐
│  STAGE 1: TRANSCRIPCIÓN                          │
│  audio → texto + word-level timestamps           │
│  Provider: Whisper (OpenAI)                     │
│  Fallback: Whisper local (ONNX)                │
└───────────────────────┬─────────────────────────┘
                        │ WhisperResult[]
                        ▼
┌─────────────────────────────────────────────────┐
│  STAGE 2: ANÁLISIS LLM                          │
│  texto + timestamps → momentos candidatos       │
│  Provider Manager → OpenAI / Claude / OpenRouter │
│  Sin razonamiento chain visible en output      │
└───────────────────────┬─────────────────────────┘
                        │ ClipCandidate[]
                        ▼
┌─────────────────────────────────────────────────┐
│  STAGE 3: SCORING & FILTRADO                    │
│  clips candidatos con scores normalizados 0-100  │
└───────────────────────┬─────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│  STAGE 4: CAPTIONS + WORD-LEVEL TIMESTAMPS      │
│  subtítulos desde Whisper word-level timestamps  │
└───────────────────────┬─────────────────────────┘
                        │ SubtitleSegment[]
                        ▼
┌─────────────────────────────────────────────────┐
│  STAGE 5: B-ROLL SUGGESTIONS (post-MVP)        │
│  DESHABILITADO por defecto en MVP               │
└───────────────────────┬─────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│  STAGE 6: EDICIÓN AUTORIZADA                     │
│  acciones de edición para revisión del usuario  │
│  NINGUNA acción aplicada sin confirmación       │
└─────────────────────────────────────────────────┘
                        │ EditAction[]
```

**Principio anti-riesgo:** Ningún paso del pipeline es bloqueante. Si la IA falla, el usuario SIEMPRE puede editar manualmente. La IA es asistencia, no requisito.

### Provider Manager

| Provider | Modelo | Stage | MVP | Costo estimado |
|----------|--------|-------|-----|----------------|
| OpenAI | whisper-1 | Transcription | Si | ~$0.006/min |
| OpenAI | gpt-4o-mini | Analysis | Si | ~$0.15/1M tok |
| Anthropic | claude-3-haiku | Analysis fallback | Si | ~$0.125/1M tok |
| OpenRouter | multi-provider | Analysis fallback | Si | variable |
| Google Gemini | gemini-2.0-flash | Post-MVP | No | ~gratis cuota |

**BYOK (Bring Your Own Key):** Modo avanzado. Clave almacenada en SecureStore/Keychain del dispositivo o cifrada AES-256-GCM en backend. Provider Manager usa la clave BYOK cuando está habilitada.

**Fallback:** OpenAI → Claude → OpenRouter → Modo degradado (edición manual).

### Validación y Versionado de Prompts

- Todo output de IA validado por JSON Schema con Zod antes de alimentar el siguiente paso.
- Si validación falla: retry 1x con prompt más estricto.
- Prompts versionados con SHA-256 checksum para auditoría.
- Los outputs NO exponen razonamiento interno del modelo.

---

## 11. JSON Schema: ClipCandidate (Clips Candidatos)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ClipCandidate",
  "description": "Un segmento de video identificado como candidato potencial para convertirse en clip. Score es referencia, no garantía de viralidad.",
  "type": "object",
  "required": ["id", "start_time", "end_time", "confidence_score", "reasons", "suggested_caption"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "Identificador único del clip candidato",
      "example": "clip_cand_001"
    },
    "start_time": {
      "type": "number",
      "description": "Tiempo de inicio en segundos",
      "minimum": 0,
      "example": 12.5
    },
    "end_time": {
      "type": "number",
      "description": "Tiempo de fin en segundos",
      "minimum": 0,
      "example": 45.2
    },
    "duration": {
      "type": "number",
      "description": "Duración calculada del clip candidato",
      "minimum": 0,
      "maximum": 300,
      "example": 32.7
    },
    "confidence_score": {
      "type": "integer",
      "description": "Puntuación 0-100. Solo referencia para el usuario, no garantiza viralidad.",
      "minimum": 0,
      "maximum": 100,
      "example": 78
    },
    "reasons": {
      "type": "array",
      "description": "Razones que justifican la detección del momento",
      "items": {
        "type": "string",
        "enum": [
          "high_energy",
          "emotional_peak",
          "key_statement",
          "punchline",
          "reveal_moment",
          "question_engagement",
          "call_to_action",
          "contrast_shift",
          "informative",
          "visual_interest"
        ]
      },
      "minItems": 1
    },
    "suggested_caption": {
      "type": "string",
      "description": "Caption sugerido basado en la transcripción. Requiere revisión del usuario.",
      "maxLength": 300
    },
    "transcript_snippet": {
      "type": "string",
      "description": "Fragmento de transcripción del momento"
    },
    "mood_tags": {
      "type": "array",
      "description": "Etiquetas de tono emocional",
      "items": {
        "type": "string",
        "enum": ["inspirational", "funny", "controversial", "educational", "emotional", "mysterious", "uplifting"]
      }
    },
    "platform_targets": {
      "type": "array",
      "description": "Plataformas recomendadas (el usuario decide)",
      "items": {
        "type": "string",
        "enum": ["tiktok", "instagram_reels", "youtube_shorts", "x"]
      }
    }
  }
}
```

---

## 12. JSON Schema: EditAction (Acciones de Edición)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "EditAction",
  "description": "Acción de edición sugerida por la IA. Requiere confirmación del usuario antes de aplicar.",
  "type": "object",
  "required": ["id", "action_type", "target_time", "parameters", "requires_confirmation"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "Identificador único de la acción"
    },
    "action_type": {
      "type": "string",
      "enum": [
        "trim",
        "add_caption",
        "add_subtitle",
        "add_transition",
        "speed_change",
        "add_soundtrack",
        "overlay_text",
        "crop_to_aspect",
        "color_adjust",
        "add_hook_frame",
        "add_ending_card"
      ]
    },
    "target_time": {
      "type": "number",
      "description": "Tiempo objetivo en segundos donde aplicar la acción"
    },
    "duration": {
      "type": "number",
      "description": "Duración afectada por la acción (si aplica)",
      "minimum": 0
    },
    "parameters": {
      "type": "object",
      "description": "Parámetros específicos de cada tipo de acción",
      "properties": {
        "caption_text": { "type": "string" },
        "caption_style": {
          "type": "string",
          "enum": ["default", "bold", "animated", "highlight_words"]
        },
        "subtitle_segment_ids": {
          "type": "array",
          "items": { "type": "string" }
        },
        "start_time": { "type": "number" },
        "end_time": { "type": "number" },
        "speed_factor": { "type": "number", "minimum": 0.25, "maximum": 4.0 },
        "aspect_ratio": { "type": "string", "enum": ["9:16", "16:9", "1:1", "4:5"] },
        "transition_type": { "type": "string", "enum": ["cut", "fade", "dissolve", "slide"] },
        "color_preset": { "type": "string", "enum": ["none", "warm", "cool", "vintage", "cinematic", "vibrant"] }
      }
    },
    "ai_confidence": {
      "type": "integer",
      "description": "Confianza de la IA en esta acción (0-100)",
      "minimum": 0,
      "maximum": 100
    },
    "requires_confirmation": {
      "type": "boolean",
      "const": true,
      "description": "Siempre true. El usuario debe confirmar cada acción."
    },
    "undo_action_id": {
      "type": "string",
      "description": "ID de la acción para deshacer esta acción"
    }
  }
}
```

---

## 13. JSON Schema: SubtitleSegment (Subtítulos Editables)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SubtitleSegment",
  "description": "Segmento de subtítulo con word-level timestamps. Timestamps source: Whisper word-level output, no estimados por LLM.",
  "type": "object",
  "required": ["id", "text", "start_time", "end_time", "words", "language"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "Identificador único del segmento"
    },
    "text": {
      "type": "string",
      "description": "Texto completo del segmento"
    },
    "start_time": {
      "type": "number",
      "description": "Tiempo de inicio en segundos (fuente: Whisper)",
      "minimum": 0
    },
    "end_time": {
      "type": "number",
      "description": "Tiempo de fin en segundos (fuente: Whisper)",
      "minimum": 0
    },
    "words": {
      "type": "array",
      "description": "Timestamps word-level desde Whisper",
      "items": {
        "type": "object",
        "required": ["word", "start", "end", "probability"],
        "properties": {
          "word": { "type": "string" },
          "start": { "type": "number", "description": "Inicio de la palabra en segundos" },
          "end": { "type": "number", "description": "Fin de la palabra en segundos" },
          "probability": {
            "type": "number",
            "description": "Probabilidad de reconocimiento de Whisper",
            "minimum": 0,
            "maximum": 1
          }
        }
      }
    },
    "language": {
      "type": "string",
      "description": "Código ISO 639-1 del idioma"
    },
    "speaker": {
      "type": "string",
      "description": "Identificador de hablante (diarización futura)"
    },
    "style_hints": {
      "type": "object",
      "description": "Sugerencias de estilo para rendering",
      "properties": {
        "capitalize": { "type": "boolean", "default": false },
        "emoji": { "type": "boolean", "default": false },
        "highlight_words": {
          "type": "array",
          "items": { "type": "string" }
        },
        "position": {
          "type": "string",
          "enum": ["bottom", "top", "center"],
          "default": "bottom"
        }
      }
    }
  }
}
```

---

## 14. Riesgos Técnicos

> Score = Impacto (1-5) × Probabilidad (1-5). ≥15 = crítico, 8-14 = alto, <8 = medio.

### Infraestructura y Pipeline de Video

| ID | Riesgo | Score | Mitigación |
|----|--------|-------|------------|
| T1 | FFmpeg falla en transcripción de entrada | 15 | Validación exhaustiva en upload (mediainfo). Cola de errores con retry. Fallback: rechazar formato con mensaje claro. |
| T2 | Remotion no escala en producción | 12 | Remotion solo en desarrollo. Producción: FFmpeg server-side con workers. |
| T3 | Storage se llena o sube costo | 16 | Lifecycle rules: raw → 7 días, exports → 30 días, proxies → 24h. Alertas de cuota. |
| T4 | Render final >60s frustra al usuario | 16 | Export en background con BullMQ. Notificación push. Preview baja calidad disponible antes. |
| T5 | FFmpeg servidor único no soporta carga | 12 | Workers separados con auto-scale. Diseño stateless del worker. |

### Pipeline de IA

| ID | Riesgo | Score | Mitigación |
|----|--------|-------|------------|
| AI1 | Whisper API falla o latencia >20s | 15 | Whisper local (ONNX) como fallback. Retry con backoff. |
| AI2 | LLM devuelve timestamps incorrectos | 16 | Whisper word-level timestamps son source of truth. LLM solo analiza texto. Validación de Schema. |
| AI3 | API costs se disparan | 15 | Rate limiting por usuario. BYOK opcional. Cache por video hash. Costo visible por sesión. |
| AI4 | TTS no disponible | 9 | MVP: subtítulos desde Whisper word-level (NO TTS). |

### Backend y Datos

| ID | Riesgo | Score | Mitigación |
|----|--------|-------|------------|
| B1 | DB schema no escala | 12 | Postgres + JSONB para timeline. Índices en project_id, user_id, status. |
| B2 | Job queue se pierde (Redis down) | 8 | BullMQ con persistencia en disco. Dead letter queue. |
| B3 | Credenciales cloud expiran | 10 | Secrets en Vault/env vars cifradas. Rotación automática. Mínimo privilegio IAM. |

---

## 15. Riesgos de Producto

| ID | Riesgo | Score | Mitigación |
|----|--------|-------|------------|
| P1 | Usuario abandona por latencia IA (>2 min) | 20 | Progress bar con etapas explícitas + ETA. Notificación push si >3 min. Tutorial in-app. |
| P2 | Clips candidatos no son relevantes | 16 | Promesa clara: "clips candidatos, no clip perfecto garantizado". Re-análisis con prompt. |
| P3 | Calidad export diferente al preview | 12 | Mismo pipeline de timeline para preview y export. QA frame-by-frame. |
| P4 | Usuario no sabe qué hacer al abrir la app | 15 | Onboarding 3 pantallas. Empty state con CTA directo. |
| P5 | Costo por usuario > disposición a pagar | 20 | Freemium: 3 videos/mes gratis. BYOK para power users. |
| P6 | Competidor copia la feature core | 16 | Enfoque en velocidad IA + editor minimalista vertical. |
| P7 | Retención baja (1 clip y no vuelve) | 20 | Proyecto guardado. Biblioteca de clips. Notificaciones de videos sin editar. |
| P8 | Contenido con derechos de autor | 12 | Disclaimer en upload. No almacenar raw > 7 días. |
| P9 | Subtítulos IA ofensivos o inexactos | 9 | Whisper word-level elimina hallucination de timing. Revisión usuario antes de exportar. |

---

## 16. Reducción de Alcance

### Qué NO construir en el MVP

| Feature | Razón de exclusión |
|---------|-------------------|
| Subtítulos IA con estilo premium (plantillas animadas) | Subtítulos planos bastan para validar el flujo |
| Detección de hooks (fine-tuning) | No bloquea validación de Clip Finder |
| Biblioteca musical o B-roll | Licensing complejo. MVP usa solo audio del video fuente |
| Multi-clip en un solo export | Exportar uno a la vez es suficiente |
| Versión de audio (podcast) | Pipeline diferenciado; el clip de video ya incluye audio |
| Colaboración / equipos | MVP es unipersonal |
| Edición multi-pista (overlays, transiciones) | Eso es CapCut; HandClip edita un clip a la vez |
| Generación de clips con IA (avatares, slides) | Contradice el modelo editorial del producto |
| Editor de marca (logos, intros/outros) | V1 si hay demanda; MVP exporta clips limpios |
| Programación de publicación | Fuera del scope de edición |
| Grabación directa desde cámara | Importar desde galería cubre el caso principal |

### Cortes para versión construible

1. **IA:** Clip Finder con modelo pre-entrenado. Subtítulos por Whisper API + placement básico. Sin hooks ni scoring de viralidad avanzado.
2. **Formato:** Solo vertical 9:16. Un clip por exportación. Resolución fija 1080x1920. Solo MP4/H.264.
3. **Procesamiento:** Videos locales solo. Sin upload a nube para procesamiento. Un video a la vez. Límite 30 min.
4. **Almacenamiento:** Sin proyectos guardados (flujo lineal). Sin historial dentro de la app.
5. **Auth:** Sin login en MVP. Instalación directa.

**MVP mínimo construible: 3 pantallas (Importar, Clip Detail, Exportar) + 2 módulos backend (Clip Discovery Service, Transcription Service).**

---

## 17. Roadmap

### Phase 0: Prototype (Semanas 1-4)

**Objetivo:** Validar flujo completo de import a export con 1 video real.

- Upload MP4 ≤ 500 MB.
- Transcode FFmpeg server-side.
- Whisper + LLM, top 3 clips candidatos.
- Preview vertical 9:16.
- Trim manual básico (in/out points).
- Export MP4.
- Sin cola de trabajos (sync para prototype).

**No incluye:** auth, billing, subtítulos IA, speed, texto overlay, re-análisis, library.

**Criteria de paso:** Usuario real logra exportar 1 clip vertical de ≤60s en <5 min desde upload.

### Phase 1: MVP (Semanas 5-10)

**Objetivo:** Producto publicable a beta cerrada con Clip Finder + Quick Edit.

- Auth (email + Google OAuth).
- Upload ≤ 2 GB.
- Clip Finder con búsqueda por keyword.
- Quick Edit: trim + subtítulos (Whisper word-level).
- Texto overlay + speed (0.5x, 1x, 2x).
- Export presets: TikTok, Reels, Shorts.
- Job queue (BullMQ) + Redis + SSE progreso.
- Proyecto guardado + biblioteca de clips.
- Almacenamiento S3/R2 con lifecycle rules.
- BYOK opcional.

**No incluye:** Generación IA de video, avatares, editor multi-pista, biblioteca musical, stock B-roll, marketplace, colaboración.

**Criteria de paso:** 10 beta testers. Retención D7 >30%.

### Phase 2: Beta (Semanas 11-16)

- Publicación directa a TikTok/Instagram (API oficial).
- Subtítulos con estilos premium.
- Re-análisis IA con prompt del usuario.
- B-Roll suggestions desde Unsplash/Pexels.
- Plan gratuito (5 videos/mes) + Pro ($9.99/mes, 50 videos).
- Dashboard de métricas básicas.

**Criteria de paso:** Churn <5%/mes, NPS >40.

### Phase 3: V1 (Semanas 17-24)

- Editor de timeline multi-pista.
- Biblioteca de clips organizable.
- Colaboración: compartir proyecto por enlace.
- TTS para voiceover IA.
- Webhooks para Zapier/Make.
- Multi-idioma UI: ES/EN/PT.
- Export 4K.

**Criteria de paso:** $10K MRR, <3 bugs críticos.

### Phase 4: V2 (Futuro)

- Generación IA de clips desde prompt.
- Avatares IA para talking-head.
- Biblioteca musical licenciada (Epidemic Sound/Artlist).
- Marketplace de presets y templates.
- API pública.

**Nota:** V2 depende de V1 con tracción. Sin $10K MRR, no avanzar a generación IA.

---

## 18. Recomendación Final

### Qué construir primero

**Secuencia concreta:**

```
SEMANA 1-2  → Upload + FFmpeg transcode (servidor único)
SEMANA 2-3  → Whisper + LLM para top-3 clips candidatos
SEMANA 3-4  → Preview 9:16 + Export MP4
               ↓
               [PROTOTYPE VALIDADO]
               ↓
SEMANA 5-7  → Auth + Clip Finder (keyword/sentiment search)
SEMANA 7-9  → Quick Edit (trim, subtitles, speed, text overlay)
SEMANA 9-10 → Job queue + S3 + lifecycle + SSE progreso
               ↓
               [MVP VALIDADO] → beta pública
```

**Razón:** El riesgo técnico más alto (FFmpeg + Whisper) se resuelve en prototype con un solo servidor. No hay sentido en construir Clip Finder si la transcripción falla. No hay sentido en construir auth si nadie quiere usar el producto.

**Inversión estimada:**

| Fase | Inversión | Gate |
|------|-----------|------|
| Prototype | 2 devs × 4 semanas | Validar flujo completo |
| MVP | 2-3 devs × 6 semanas | Retención D7 >30% |
| Beta | 1 dev part-time + growth | Solo si MVP retiene |
| V1 | 3 devs × 8 semanas | Solo si MRR >$5K |
| V2 | 5 devs × 12+ semanas | Postergar hasta V1 validado |

**No hacer en MVP aunque "sería genial":**
- Generación IA de video desde cero.
- Editor profesional multi-pista.
- Biblioteca musical propia.
- TTS.
- Marketplace.

---

## Apéndice A: Checklist de Aceptación del MVP

### Funcionalidad Core
- [ ] Upload MP4, MOV, WEBM ≤ 2 GB
- [ ] Transcode FFmpeg produce proxy 1080x1920 @ 30fps
- [ ] Whisper transcribe con word-level timestamps correctos
- [ ] LLM devuelve ClipCandidate[] válido con scores 0-100 según schema
- [ ] Top 3-5 clips candidatos con preview < 5s por clip
- [ ] Clip Finder permite búsqueda por keyword
- [ ] Quick Edit: trim con in/out points
- [ ] Subtítulos burned-in en export final
- [ ] Texto overlay en export
- [ ] Speed control (0.5x, 1x, 2x) en export
- [ ] Export MP4 en preset TikTok/Reels/Shorts (1080x1920, 30fps, AAC 128kbps)
- [ ] Proyecto se guarda y reabre
- [ ] Biblioteca muestra clips exportados

### Progreso y Feedback
- [ ] Progress bar con etapas: "Transcribiendo", "Analizando", "Renderizando"
- [ ] ETA visible cuando etapa > 30s
- [ ] Notificación push cuando export termina
- [ ] Error con mensaje claro en fallos de upload / transcripción
- [ ] Sin dead UI: cada estado tiene feedback visual

### Auth y Storage
- [ ] Registro email/password
- [ ] Login Google OAuth
- [ ] Sesión persiste al cerrar app
- [ ] Lifecycle rules aplicadas (raw: 7d, exports: 30d, proxies: 24h)
- [ ] Quota visible para usuario

### Performance
- [ ] Transcripción 5 min en < 60s
- [ ] Análisis LLM 5 min en < 30s
- [ ] Preview < 10s (720p)
- [ ] Export 60s en < 120s
- [ ] Sin memory leak tras 10 exports consecutivos

### Mobile UX
- [ ] Todo el flow completable con un pulgar
- [ ] Onboarding primer uso
- [ ] Empty state con CTA claro
- [ ] Preview vertical 9:16
- [ ] Sin scroll horizontal accidental
- [ ] Botón exportar siempre visible
- [ ] Soporte offline parcial (proyecto visible sin conexión)
