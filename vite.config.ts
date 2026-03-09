import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
