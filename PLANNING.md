# Svg3Ddesign — Planning & Architecture

> Living document capturing the analysis, decisions and roadmap for extracting
> the `3dsvg` core into a reusable package consumed by **CrackingWall**.

---

## 1. Goal

Learn-by-doing while shipping a real feature: distill the SVG/text → 3D core of
[`3dsvg`](https://github.com/renatoworks/3dsvg) into its **own repo/package**,
then plug it into CrackingWall as a new creative tool — keeping things **ordered,
professional and viable**.

---

## 2. What `3dsvg` actually is (the honest baseline)

A monorepo with two parts:

- **`packages/engine`** (= the published `3dsvg` npm lib) → **the core**. Turns
  text/SVG into an interactive 3D React component (Three.js + R3F). **Runs 100%
  in the browser (WebGL).** Text→SVG via `opentype.js`, extrude via `SVGLoader`,
  materials/lighting/animation/orbit.
- **`packages/web`** → the Next.js playground (3dsvg.design). Pixel editor,
  export to video/GIF via **`ffmpeg` WASM (client-side)**, embed/download
  dialogs. The only server code is `/api/feedback` (an email via Resend).

**Key takeaway:** the core is a **frontend library**, not a backend service.
3dsvg.design's resource model = *all heavy compute on the user's device, host
serves static assets only.*

---

## 3. Microservices framing (brutally honest)

A microservice is a backend deployable with a network boundary. This product has
no heavy backend — so a microservice here would be **over-engineering**. The only
legitimate server-side opportunities are moving headless work off the browser:

| Approach | What | Real microservice? | Effort | Notes |
|---|---|---|---|---|
| **A — Package** | Embed the engine as a lib; render client-side | ❌ library | Low | Identical result, zero infra |
| **B — Render service** | params → PNG/MP4 (headless) | ✅ | High | **Needs GPU** → not viable on free tier |
| **C — GLB service** | params → `.glb` geometry (no pixels) | ✅ | Medium | No GPU; cache by hash |
| **D — App + iframe** | deploy `web` standalone, embed | ⚠️ micro-frontend | Low-Med | Loose integration |
| **E — Web component / MF** | engine as `<svg-3d>` on CDN | ⚠️ micro-frontend | Med | Runtime decoupling |

### Geometry ≠ Pixels (the concept that decides everything)
- **Geometry** (`.glb`) = the *shape* (+ PBR materials). Pure math, **no GPU**.
- **Pixels** = the *final image* = geometry **+ lights + environment/HDRI +
  shadows + camera**. **Needs WebGL/GPU.**
- If the **browser** renders (our tool), the result is **identical to the
  original** regardless of A or C — the browser does the WebGL.
- A server-made image identical to the original requires **B** (GPU). A `.glb`
  in a *generic* viewer looks close but not identical (HDRI/shadows/camera don't
  travel inside the file).

---

## 4. Constraints

- **Hosting:** Cloudflare (free tier) + optionally Render (free tier).
- **No GPU anywhere on free tier** → **B is off the table for now.**
- CrackingWall runs on **Cloudflare Workers** → cannot do headless WebGL.
- Render free tier **sleeps after ~15 min** (cold start 30–60s), 512 MB RAM.

---

## 5. Decisions (locked)

1. **Wrapper, not fork.** Depend on `3dsvg` (MIT) and add a curated CrackingWall
   layer (presets, brand defaults). Receive upstream fixes; minimal maintenance.
2. **React 19.** Aligns with upstream (`@react-three/fiber` 9 requires React 19).
   → CrackingWall must upgrade 18 → 19 to consume.
3. **Client-first, no microservice (for now).** Mirror 3dsvg.design's resource
   model. The microservice path is **deferred** until a real requirement exists.
4. **Separate repo as a *package*** for order/ownership — note: repo separation
   ≠ microservice. We get cleanliness without operational burden.

### Priority verdict
For a professional product, **viability/infra wins over forcing a microservice
to learn**. Building unneeded infra is an anti-pattern. The pro lesson here is
knowing **when *not* to** build a service.

### When a service *would* be justified (future)
Server-side OG-images/thumbnails at scale, serving `.glb` to third parties, or
heavy batch exports. Then extract **C** (no GPU) — or **B** on a paid GPU host.
Free-tier-friendly way to get images meanwhile: **render in the client, upload**.

---

## 6. Package shape

```
Svg3Ddesign/
├─ src/
│  ├─ index.ts        # public API
│  ├─ Svg3D.tsx       # wrapper over 3dsvg <SVG3D> (brand defaults + preset)
│  ├─ presets.ts      # neon · glitch · chrome · gold · glass
│  └─ types.ts        # re-export + Svg3DProps (adds `preset`)
├─ examples/          # Vite + React 19 playground (aliased to ../src)
├─ dist/              # build output (gitignored)
└─ .github/workflows/ci.yml
```

- **Build:** `tsup` → ESM + `.d.ts`.
- **Peer deps** (host provides one copy): `react`, `react-dom`, `three`,
  `@react-three/fiber`, `@react-three/drei`, `3dsvg`.
- **API:** `<Svg3D text="CW" preset="neon" />` + `PRESETS` + types.
  Priority of props: `brand defaults < preset < explicit props`.

---

## 7. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| **0** | `<Svg3D>` wrapper + presets + tsup build | ✅ done |
| **1** | Vite playground (`examples/`) | ✅ done |
| **2** | Release `v0.1.0` (tag → npm on token, else git-dep) | ⏳ in progress |
| **3** | Integrate in CrackingWall: React 19 + `/3d-lab` island (`client:only`) + lazy-load | ⏳ |
| **4** | Client-side export (PNG/GLB, `ffmpeg` on demand), on-brand polish | ⏳ |
| **5** | Docs + semver + automated npm publish | ⏳ |

---

## 8. Consuming the package

- **Now (no publish):** git dependency — `prepare` builds on install:
  `npm i github:FilipaoVfx/Svg3Ddesign three @react-three/fiber @react-three/drei 3dsvg`
- **Later (npm):** add repo secret `NPM_TOKEN`, then `git tag vX.Y.Z && git push --tags` → CI publishes.

### CrackingWall integration notes
- Upgrade to **React 19** first; smoke-test existing islands (ASCII Lab,
  AppTopBar, AuthModal, ImageAnalyzer).
- New tool `/3d-lab` as **`client:only="react"`** island (WebGL, no SSR — same
  pattern as ASCII Lab). **Lazy-load** the canvas + export to keep the initial
  bundle lean.
- Add "3D Lab" to the sidebar Tools group.

---

## 9. Credits & license

This package is a thin wrapper over **`3dsvg`** (MIT © Renato Costa). MIT.
