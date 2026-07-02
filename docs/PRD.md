# SVG Advanced Playground Engine — PRD v2.1 (corregido)

**Producto:** CrackingWall · 3D Lab — motor `@filipaovfx/svg3d`
**Estado:** Aprobado para implementación · rama `3dlab`
**Reemplaza a:** `svgEnviroment.md` v2.0 (draft). Esta versión integra la verificación
contra el engine real (v0.9.0) y corrige 6 conflictos del draft.

---

## Visión

No competimos con Blender/Spline en controles. La ventaja es un **motor de
reconstrucción inteligente**: comprender un SVG como activo creativo completo y
generar automáticamente una escena 3D de alta fidelidad, 100% en el navegador.

```
SVG → Intelligence → Spatial Reconstruction → Asset Profile
    → Geometry → Material → Scene → Playground → Export
```

## Principios (sin cambios)

1. **Performance First** — toda decisión responde: ¿mantiene 60 FPS? Si no →
   Worker / background / cache / lazy. Nunca en el render loop.
2. **Intent-driven** — el usuario manipula intención (relief, material, luz),
   nunca vértices.
3. **Zero friction** — upload → reconstrucción automática → ajustar → export.

## Métricas de éxito

| Métrica | Objetivo |
|---|---|
| Viewport | 60 FPS (frame ≤16 ms, main thread ≤4 ms) |
| Feedback de edición | <100 ms |
| Generación (SVG estándar) | <5 s |
| Memoria | <300 MB |

---

## ✏️ Correcciones sobre el draft v2.0 (normativas)

### C1 — AI Layer: opt-in explícito (conflicto de privacidad)
El draft ponía `SVG → LLM → Asset Profile` bajo "Todo Browser Side". Enviar el
SVG a un LLM (OpenRouter) **contradice el claim en producción** del 3D Lab
(*"your files never leave your device"*, hero + FAQ). Norma:
- El pipeline base es **100% local**; la capa AI es **opt-in** con un control
  visible ("Enhance with AI — sends your SVG to our analysis service").
- Al activarla, la UI y la FAQ deben reflejarlo. Nunca por defecto.
- La capa AI **solo analiza** (Asset Profile); jamás renderiza.

### C2 — Presupuesto de geometría: unidad única
El draft decía 250k **triángulos**; el engine mide **vértices** (300k). Norma:
el presupuesto oficial es **triángulos** — Desktop **250k**, Mobile **80k**.
El estimador actual (vértices) es aceptable como proxy transitorio; la
migración del estimador a triángulos es parte de la Phase 2. Si se supera:
reducir subdivisión/chamfer → LOD.

### C3 — Occlusion Solver: híbrido, no reemplazo
El draft ordenaba "no depender del Paint Order". **El paint order es la
intención del autor** y fue el fix que resolvió la fidelidad per-shape (caso
clown). Norma: el Depth Graph usa **paint order como prior** y lo refina con
señales espaciales (contención, solape, bboxes). Regla clave: elementos
**disjuntos** (sin solape) comparten nivel; elementos que **solapan** se apilan
según paint order; elementos **contenidos** suben como relieve sobre su
contenedor. Nunca `depth = index` a secas.

### C4 — Mesh Gradients: fuera de scope
SVG 2 mesh gradients no tienen soporte real en navegadores ni presencia en
assets reales. Se retiran del requisito (best-effort futuro). Linear/radial se
mantienen.

### C5 — Parser: Filters y Text pasan a fase tardía
Los filtros SVG son efectos 2D sin traducción 3D bien definida (limitación ya
documentada del producto); Text exige carga/outlining de fuentes (sub-proyecto).
El Module 1 "soporte completo" se re-alcanza: **core** = paths, groups, nested
groups, transform, fill, gradientes lin/rad, symbols/use, stroke; **fase
tardía** = text, patterns; **no-goal 3D** = filters (se ignoran con warning).

### C6 — Workers: reparto realista
`BufferGeometry`/Three no puede crearse dentro de un Worker. Norma de reparto:
- **Worker:** parse, topología, bboxes, depth graph, triangulación/earcut,
  serialización de buffers, export GLB.
- **Main:** construcción de `BufferGeometry` desde buffers transferidos
  (transferables), render, cámara, UI, materiales.

**Además (C7, técnico):** Gradient→relief usa **normal maps por defecto**
(relieve visual a costo ~0 de geometría). Displacement real solo en export
high-LOD, nunca en viewport (conflicto con C2).

---

## Módulos y estado (v0.9.0 → objetivo)

| # | Módulo | Estado v0.9.0 | Phase |
|---|--------|---------------|-------|
| 1 | SVG Parser (core re-alcanzado C5) | 🟡 parcial | 2–3 |
| 2 | Semantic Analyzer (asset type) | 🔴 | 5 (con AI opt-in C1) |
| 3 | Layer Intelligence (jerarquía lógica) | 🟡 `<g id>` + per-shape | 2 |
| 4 | Topology Engine | 🟡 holes/fillRule | 3 |
| 5 | Gradient Intelligence (C7: normal maps) | 🔴 color promedio | 3 |
| 6 | **Spatial Reconstruction** (C3: híbrido) | 🔴 **prioridad #1** | **2** |
| 7 | Relief Engine | 🟡 depth+bevel por capa | 3 |
| 8 | Adaptive Extrusion | 🟡 por rol | 2 |
| 9 | Material Intelligence | 🟡 6 materiales | 3 |
| 10 | Color Intelligence | 🟡 resolver+brightness | 3 |
| 11 | Scene Generator | 🟢 4 presets + auto | 4 (Dark/Showcase) |
| 12 | Playground | 🟡 Layer Explorer plano | 4 |
| — | Workers (C6) | 🔴 async main-thread | 2 |
| — | Smart Regeneration | 🟡 material sin rebuild | 2 |
| — | Geometry Cache | 🟡 análisis por hash | 3 (meshes/GLB) |
| — | LOD | 🔴 | 3 |
| — | Export | 🟡 GLB/PNG | 4 (poster, GLTF; roadmap USDZ/OBJ/MP4) |

## Roadmap actualizado

- **Phase 1 — ✅ hecha (v0.1–v0.9):** parser core, geometry engine, GLB export,
  per-shape granularity, painter z-order, presets, budget advisory, cache hash.
- **Phase 2 (en curso, rama `3dlab`):** Spatial Reconstruction v1 heurística
  (bboxes + contención/solape + paint-order prior → Depth Graph), Workers (C6),
  Smart Regeneration granular, migración del estimador a triángulos (C2).
- **Phase 3:** Gradient Intelligence (normal maps C7), Topology avanzada,
  Material/Color Intelligence ampliados, cache de meshes, LOD.
- **Phase 4:** Playground avanzado (jerarquía, transform, lighting, animation
  presets), Scene Generator completo, export poster/GLTF.
- **Phase 5:** AI opt-in (C1): semantic asset recognition + presets inteligentes.

## No-goals

- Editor 3D general (Blender/Spline). Timeline complejo de animación.
- GPU server-side. Mesh gradients (C4). Traducción 3D de filtros SVG (C5).
