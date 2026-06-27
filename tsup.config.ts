import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  // Provided by the consumer (single shared copy of Three/React)
  external: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '3dsvg', 'opentype.js'],
});
