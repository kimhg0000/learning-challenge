import { defineConfig } from 'vitest/config';

// Requires the Firebase emulators running (see package.json "integration:test").
// Not part of the normal `npm test` loop.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
