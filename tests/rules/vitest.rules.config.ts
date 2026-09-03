import { defineConfig } from 'vitest/config';

// Separate from the root vite.config.ts on purpose: these tests require the
// Firebase emulators to already be running (see tests/rules/README.md) and
// must never accidentally run as part of the normal `npm test` / `vitest`
// loop, which only exercises tests/unit and needs no emulator at all.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    // Both files talk to the same running emulator project. Running them in
    // parallel workers lets one file's beforeEach(clearFirestore/clearStorage)
    // race the other file's in-flight assertions against the same emulator
    // state, causing flaky cross-file failures. These are cheap to run, so
    // just force them fully sequential instead of trying to isolate projects.
    fileParallelism: false,
  },
});
