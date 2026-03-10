import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

export default defineConfig({
  plugins: process.env.DEMO_USE_HTTPS === 'true' ? [basicSsl()] : [],
  resolve: {
    alias: {
      '@simprints/simface-sdk': resolve(repoRoot, 'dist/simface-sdk.js'),
    },
  },
  server: {
    port: 4173,
    fs: {
      allow: [repoRoot],
    },
  },
});
