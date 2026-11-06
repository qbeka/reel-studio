import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The project page in site/. Paths stay relative so it works under any folder. The public
 * folder carries the viewer runtime, because the page's Export builds a real bundle.
 */
export default defineConfig({
  root: 'site',
  base: './',
  publicDir: '../public',
  plugins: [react()],
  build: { outDir: '../dist/site', emptyOutDir: true, assetsInlineLimit: 0 },
});
