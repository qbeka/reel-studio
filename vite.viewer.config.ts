import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds the viewer runtime that every exported bundle contains. `base: './'` makes all
 * asset URLs relative, so a bundle works under any path, such as /projects/reel/.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/viewer',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: { input: 'viewer.html' },
  },
});
