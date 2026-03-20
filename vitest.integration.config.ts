import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@simprints/simface-sdk': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    include: ['src/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    sequence: {
      // Integration tests are order-dependent (enroll before verify)
      concurrent: false,
    },
  },
});
