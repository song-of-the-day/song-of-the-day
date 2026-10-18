import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Where the dev server forwards `/api` (override with `SOTD_API_PROXY`, e.g. for a second stack). */
const apiProxyTarget = process.env.SOTD_API_PROXY ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fromHere('./src'),
      '@shared': fromHere('../shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiProxyTarget },
    },
    fs: {
      // The repo root, so `@shared/theme-options.json` (outside this package) can be served.
      allow: [fromHere('..')],
    },
  },
});
