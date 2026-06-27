import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Alias the package to its TS source for a live edit loop (no rebuild needed).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@filipaovfx/svg3d': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
    // Single shared copy of these (the aliased source imports them too)
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '3dsvg'],
  },
});
