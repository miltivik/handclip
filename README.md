# HandClip

HandClip convierte videos largos en clips verticales (9:16) para TikTok, Reels y Shorts.
Detecta los momentos con potencial de un video y los marca como candidatos; el
creador decide cuáles editar y exportar.

## El problema

Los creadores de contenido graban videos de 10–30 minutos (tutoriales, podcasts,
entrevistas, vlogs) y necesitan sacar clips cortos para redes. El flujo manual —
revisar todo el video, cortar, subtitular, reformatear a 9:16, exportar — es
lento, repetitivo y depende de editores profesionales o habilidades técnicas.

## La propuesta

HandClip automatiza la detección: a partir de un video subido, identifica hasta
10 candidatos con puntaje de potencial y razones (energía, punchline, emoción,
discurso claro). El usuario revisa, ajusta trim y subtítulos, y exporta. Un
video de 10 minutos se procesa end-to-end en menos de 5 minutos.

**Lo que NO es:** editor profesional de video, generador de contenido desde
cero, plataforma de distribución o programación social. La promesa es
**encontrar y editar**, no generar clips perfectos listos para publicar.

## MVP

- Importar un video desde galería (iOS / Android)
- Detectar hasta 10 clips candidatos (Whisper + análisis de contenido)
- Seleccionar, previsualizar, ajustar trim con handles táctiles
- Subtítulos generados desde transcripción con corrección inline
- Exportar un clip a la vez (MP4 / H.264, vertical 9:16)
- Auth por magic link + Google
- Una cuenta por usuario, sin equipo ni workspaces

Criterio de éxito: un usuario puede importar un video de 10 minutos, encontrar
3 clips candidatos, añadir subtítulos, exportar uno y compartirlo — en menos
de 5 minutos.

## Stack

- **Mobile**: Expo (React Native) + Zustand + expo-router
- **API + Worker**: NestJS monorepo (`apps/api`, `apps/worker`, `libs/shared`)
- **Data**: Supabase (Postgres + Auth + Storage + RLS como source of truth)
- **Async**: BullMQ sobre Redis
- **Video**: FFmpeg en el worker (no shell) · transcripción con OpenAI Whisper
- **Infra**: Docker Compose local (Redis), Vercel / Railway para deploys

## Layout

```
handclip/
├── handclip-app/        # Cliente Expo (iOS, Android)
├── handclip-backend/    # Monorepo: API + Worker + shared lib
├── docker-compose.yml   # Redis para BullMQ
├── docs/                # Plan de producto, arquitectura, distribución de tareas
└── graphify-out/        # Knowledge graph (graphify, opcional)
```

## Quick start

```bash
# Backend (API + Worker)
cd handclip-backend
cp apps/api/.env.example    apps/api/.env
cp apps/worker/.env.example apps/worker/.env
pnpm install
docker compose -f ../docker-compose.yml up redis -d
pnpm -r test      # 51 tests
pnpm -r dev       # API :3000, Worker :3001
```

Mobile:

```bash
cd handclip-app
npx expo start
```

Requisitos globales: Node 22+, pnpm, Docker, una cuenta de Supabase.

## Docs

- [handclip-backend/README.md](handclip-backend/README.md) — setup, env,
  security posture, status por fase, test commands
- [docs/handclip/handclip-product-technical-plan.md](docs/handclip/handclip-product-technical-plan.md)
  — producto, user stories, arquitectura detallada, schema de DB, contratos
- [docs/handclip/task-distribution-minimax-m27.md](docs/handclip/task-distribution-minimax-m27.md)
  — distribución de tareas entre agentes

## Status

- **Backend**: API + Worker funcionales. 51 tests pasando, type-check limpio
  en los 3 packages. Security hardening en producción (SSRF guards, rate
  limits, ownership checks, etc.)
- **Mobile**: cliente mínimo funcional (auth, import, candidates, edit,
  export screens)
- **Smoke E2E**: pendiente — el gap entre "compila" y "funciona" requiere
  `docker compose up` con Supabase real

Detalle por fase en
[handclip-backend/README.md § Status](handclip-backend/README.md#status).
