import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

export default defineConfig({
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
