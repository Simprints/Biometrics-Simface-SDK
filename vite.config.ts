import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Let vitest resolve the SDK package name when running demo tests.
      // No SDK source file self-imports, so this only affects tests.
      '@simprints/simface-sdk': resolve(__dirname, 'src/index.ts'),
    },
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SimFaceSDK',
      fileName: 'simface-sdk',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // No external deps — bundle everything for drop-in use
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
