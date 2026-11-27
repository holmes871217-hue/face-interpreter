import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// The CSP meta tag blocks Vite's dev-time inline scripts (HMR); keep it only in production builds.
const stripCspInDev = (): Plugin => ({
  name: 'strip-csp-in-dev',
  apply: 'serve',
  transformIndexHtml: html => html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
});

// base './' so the bench can be hosted under any sub-path (e.g. GitHub Pages /<repo>/).
export default defineConfig({
  base: './',
  plugins: [react(), stripCspInDev()],
  worker: { format: 'es' },
  define: { __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'local').slice(0, 7)) },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
