import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The local editor. The exported viewer has its own config, vite.viewer.config.ts. */
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist/editor', emptyOutDir: true, assetsInlineLimit: 0 },
});
