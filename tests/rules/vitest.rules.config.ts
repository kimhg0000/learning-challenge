import { defineConfig } from 'vitest/config';

// Separate from the root vite.config.ts on purpose: these tests require the
// Firebase emulators to already be running (see tests/rules/README.md) and
// must never accidentally run as part of the normal `npm test` / `vitest`
// loop, which only exercises tests/unit and needs no emulator at all.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
  },
});
