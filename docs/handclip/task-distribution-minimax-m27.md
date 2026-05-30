# HandClip — Plan de Distribución TASK (Minimax M2.7)

> **Objetivo:** Distribuir el trabajo de planificación de HandClip entre 6 subagentes `TASK` con instrucciones autocontenidas.
> **Modelo objetivo:** Minimax M2.7 si el orquestador permite seleccionarlo; si no, usar `TASK` estándar.
> **Output esperado:** Markdown plano, sin editar archivos, sin ejecutar gates/formateadores.

---

## Contexto Común (Prepend a cada assignment)

```markdown
# Goal
Convertir HandClip en un plan accionable de producto y arquitectura para un MVP mobile-first de edición de clips con IA.

# Constraints
- Responder en español claro, concreto y orientado a desarrollo real.
- Modelo objetivo: Minimax M2.7 si el orquestador permite seleccionarlo; si no, usar TASK estándar.
- No escribir código de app ni crear scaffolds.
- No inflar el MVP: mantener foco en Clip Finder y Quick Edit.
- No incluir generación de video IA desde cero, avatares, marketplace, editor profesional, biblioteca musical propia ni stock B-roll propio en MVP.
- Priorizar móvil, vertical 9:16, subtítulos premium, cortes dinámicos, hooks, preview y exportación simple.
- Cada subagente debe devolver Markdown autocontenido; no editar archivos ni ejecutar gates/formateadores.

# Contract
Los outputs deben alimentar un documento final con: definición del producto, MVP, user stories, flujos, arquitectura, DB inicial, módulos backend, carpetas frontend/backend, pipeline video, pipeline IA, JSON schemas, riesgos, reducción de alcance, roadmap Prototype/MVP/Beta/V1/V2 y recomendación inicial.
```

---

## TASK 1 — ProductScopeStrategist

```markdown
# Target
No editar archivos. Cubrir definición de producto, propuesta de MVP, posicionamiento frente a CapCut, target inicial y reducción de alcance.

# Change
Entregar secciones Markdown para:
1. Definición clara del producto.
2. Propuesta de MVP.
3. Diferencial frente a CapCut.
4. Qué NO construir en MVP.
5. Cómo reducir alcance para una primera versión construible.

# Acceptance
- Mantiene foco en Clip Finder y Quick Edit.
- No propone features fuera de alcance.
- Define una promesa realista: clips candidatos, no "clip perfecto garantizado".
- Incluye recomendación concreta de priorización.

Responde ÚNICAMENTE con el Markdown de las secciones solicitadas. No añadas introducción, saludo ni cierre.
```

---

## TASK 2 — MobileUXFlows

```markdown
# Target
No editar archivos. Cubrir user stories, flujos mobile-first y estados de UX.

# Change
Entregar secciones Markdown para:
1. User stories principales agrupadas por rol/objetivo.
2. Flujo de usuario Clip Finder.
3. Flujo de usuario Quick Edit.
4. Flujo de corrección manual en mobile.
5. Progreso visible de IA y plan editable sin mostrar razonamiento interno.
6. Consideraciones UI para subtítulos premium, timeline y selección de rangos.

# Acceptance
- Los flujos funcionan desde teléfono.
- El usuario siempre puede revisar/corregir antes de exportar.
- Incluye referencias por rango generadas por selección en timeline, no escritura manual obligatoria.
- Evita complejidad de editor profesional.

Responde ÚNICAMENTE con el Markdown de las secciones solicitadas. No añadas introducción, saludo ni cierre.
```

---

## TASK 3 — BackendArchitecture

```markdown
# Target
No editar archivos. Cubrir arquitectura técnica, módulos backend, DB inicial y estructura de carpetas backend/frontend.

# Change
Entregar secciones Markdown para:
1. Arquitectura técnica general.
2. Módulos backend MVP y futuros.
3. Estructura inicial de base de datos Supabase Postgres con tablas, campos clave y relaciones.
4. RLS/Auth/Storage de alto nivel.
5. Estructura de carpetas recomendada para Expo y NestJS.
6. API surface inicial REST y eventos de progreso por SSE/WebSocket.

# Acceptance
- Compatible con Node.js, TypeScript, NestJS, Supabase, BullMQ y Redis.
- No diseña billing complejo en MVP.
- Incluye separación API/worker.
- Incluye estado de jobs y proyectos sin sobre-modelar.

Responde ÚNICAMENTE con el Markdown de las secciones solicitadas. No añadas introducción, saludo ni cierre.
```

---

## TASK 4 — VideoPipelineArchitect

```markdown
# Target
No editar archivos. Cubrir procesamiento de video, preview, render y exportación.

# Change
Entregar secciones Markdown para:
1. Pipeline de procesamiento de video desde upload hasta export final.
2. Responsabilidades FFmpeg vs Remotion.
3. Generación de preview rápido y render final.
4. Manejo de música importada: trim, volumen, fade, mezcla voz/música.
5. Presets de exportación: TikTok/Reels/Shorts, Draft Preview, High Quality.
6. Sugerencias de B-roll como marcadores editables.

# Acceptance
- No propone render en dispositivo como flujo principal para MVP.
- Prioriza renders verticales 1080x1920, MP4, 30 FPS.
- Mantiene advanced settings escondidos.
- Incluye puntos de fallo y reintentos razonables sin convertirlo en plataforma gigante.

Responde ÚNICAMENTE con el Markdown de las secciones solicitadas. No añadas introducción, saludo ni cierre.
```

---

## TASK 5 — AIContractsArchitect

```markdown
# Target
No editar archivos. Cubrir pipeline IA y contratos JSON.

# Change
Entregar secciones Markdown y JSON para:
1. Pipeline IA: transcripción, análisis, scoring, clips candidatos, captions, B-roll suggestions y edición.
2. Provider Manager con OpenAI, Claude, OpenRouter y Gemini futuro.
3. BYOK como modo avanzado, con claves en SecureStore/Keychain o cifradas en backend.
4. JSON Schema para clips candidatos. Incluye el schema completo en un bloque ```json.
5. JSON Schema para acciones de edición. Incluye el schema completo en un bloque ```json.
6. JSON Schema para subtítulos editables. Incluye el schema completo en un bloque ```json.
7. Validación, versionado de prompts y fallback ante errores.

# Acceptance
- Todo output de IA usado programáticamente está validado por schema.
- No expone razonamiento interno del modelo.
- No promete perfección viral garantizada.
- Incluye word-level timestamps para captions.

Responde ÚNICAMENTE con el Markdown de las secciones solicitadas. No añadas introducción, saludo ni cierre.
```

---

## TASK 6 — RisksRoadmapReviewer

```markdown
# Target
No editar archivos. Cubrir riesgos, fases y recomendación final.

# Change
Entregar secciones Markdown para:
1. Riesgos técnicos principales y mitigaciones.
2. Riesgos de producto y mitigaciones.
3. Roadmap por fases: Prototype, MVP, Beta, V1, V2.
4. Recomendación final de qué construir primero.
5. Checklist de aceptación del MVP.

# Acceptance
- Riesgos priorizados por impacto/probabilidad.
- Roadmap no infla MVP.
- Prototype y MVP son construibles sin depender de generación IA de video desde cero.
- La recomendación inicial es concreta y secuenciada.

Responde ÚNICAMENTE con el Markdown de las secciones solicitadas. No añadas introducción, saludo ni cierre.
```

---

## Plan de Ejecución con `task` Tool

### Configuración del Orquestador

Si el orquestador soporta selección de modelo, configurar Minimax M2.7. Si no, usar agente `TASK` estándar. Las instrucciones son compatibles con ambos modos.

### Orden de Ejecución

Los 6 subagentes son independientes entre sí — se ejecutan en paralelo:

```json
{
  "agent": "task",
  "tasks": [
    { "id": "ProductScopeStrategist", "assignment": "..." },
    { "id": "MobileUXFlows", "assignment": "..." },
    { "id": "BackendArchitecture", "assignment": "..." },
    { "id": "VideoPipelineArchitect", "assignment": "..." },
    { "id": "AIContractsArchitect", "assignment": "..." },
    { "id": "RisksRoadmapReviewer", "assignment": "..." }
  ],
  "context": "..." // Contexto común de arriba
}
```

### Consolidación Posterior

1. Recibir los 6 outputs.
2. Integrar en `docs/handclip/handclip-product-technical-plan.md`.
3. Extraer los 3 JSON Schemas a `docs/handclip/schemas/`.
4. Validar que los 18 entregables estén cubiertos.
5. Verificar que el MVP no incluye funcionalidades prohibidas.
6. Verificar que el plan mantiene Clip Finder y Quick Edit como núcleo.

### Lecciones Aprendidas (Ejecución 2026-05-28)

Durante la ejecución, los agentes `MobileUXFlows` (TASK 2) y `BackendArchitecture` (TASK 3) devolvieron resúmenes en lugar del contenido completo. Esto se debió a que los subagentes generaron contenido extenso pero lo resumieron en lugar de retornarlo completo.

**Mitigación para futuras ejecuciones:**
- Agregar explícitamente "NO resumas tu respuesta. Devuelve TODO el contenido generado sin truncar." en cada assignment.
- O bien ejecutar TASK 2 y TASK 3 de forma secuencial (no paralela) con un límite de output más alto.
- Alternativa: dividir TASK 2 y TASK 3 en sub-tareas más pequeñas para que el output de cada una sea manejable.
