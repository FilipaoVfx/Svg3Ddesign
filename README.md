# @filipaovfx/svg3d

Opinionated **SVG / text → interactive 3D** React component for **CrackingWall**.

Built as a thin wrapper on top of [`3dsvg`](https://github.com/renatoworks/3dsvg)
by Renato Costa (MIT) — this package adds CrackingWall presets, brand defaults
and a curated API. All rendering happens **client-side** (WebGL); there is no
backend.

## Install

```bash
npm install @filipaovfx/svg3d three @react-three/fiber @react-three/drei 3dsvg
```

> Requires **React 19**. `three`, `@react-three/fiber`, `@react-three/drei`
> and `3dsvg` are peer dependencies (the host app provides a single copy).

## Usage

```tsx
import { Svg3D } from '@filipaovfx/svg3d';

// On-brand preset
<Svg3D text="CW" preset="neon" />

// Any 3dsvg prop still works (overrides the preset)
<Svg3D svg={mySvgString} preset="chrome" depth={2} animate="spinFloat" />
```

Presets: `neon` · `glitch` · `chrome` · `gold` · `glass`.

## Develop

```bash
npm install
npm run dev        # tsup --watch
npm run build      # dist/ (ESM + .d.ts)
npm run typecheck
```

## Credits

Powered by [`3dsvg`](https://github.com/renatoworks/3dsvg) (MIT © Renato Costa).
