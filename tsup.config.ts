import { defineConfig } from 'tsup';

export default defineConfig({
  // analysis.worker is a separate self-contained bundle so
  // `new Worker(new URL('./analysis.worker.js', import.meta.url))` resolves
  // from dist at runtime (Vite/webpack5/Astro handle the URL pattern).
  entry: ['src/index.ts', 'src/analysis.worker.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  treeshake: true,
  sourcemap: true,
  clean: true,
  // No shared chunks: the worker bundle must be standalone (duplicating the
  // small pure intelligence layer is fine).
  splitting: false,
  // Provided by the consumer (single shared copy of Three/React). The
  // gltf-transform packages stay external so the consumer's bundler
  // code-splits the dynamic import (only loaded when a GLB is exported).
  external: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '3dsvg', 'opentype.js', '@gltf-transform/core', '@gltf-transform/extensions', '@gltf-transform/functions'],
});
