# Security rules tests

These tests exercise `firestore.rules` against the real rules engine via the
Firebase Local Emulator Suite. They were **written but not executed** in the
environment this project was built in, because that environment has no Java
runtime (the Firestore/Storage emulators are JVM-based) — `java -version`
returns "command not found". Everything else in this project (unit tests,
production build, and a full manual click-through of every screen) was run
and verified; only this one test suite is unverified pending Java.

## Running them

1. Install a JDK 17+ (e.g. `winget install Microsoft.OpenJDK.17` on Windows,
   or `brew install openjdk@17` on macOS).
2. `npm run rules:test`

That script runs `firebase emulators:exec --only firestore,storage,auth "vitest run tests/rules"`,
which boots the emulators, points the tests at them, runs once, and tears
them down. No real Firebase project or network access is required — the
emulators are fully local.

## What's covered

- A student can read/write only their own `users/{uid}` document, never
  another student's.
- A student cannot set `role: 'instructor'` on their own document.
- A student cannot change `characterType` after it's first set.
- A student cannot read another student's `submissions` document.
- A submission can only be created inside its own week's Mon–Sun window
  (both a too-early and a too-late attempt are rejected).
- A second submission for the same student+week is rejected (idempotency).
- A `feedPosts` document can only be created alongside a real private
  submission the caller already owns, and only with fields on the allowed
  list (no `uid`/`email`/`name`/`studentId` can be smuggled in).
- An account not present in `instructorAllowlist` can never read the
  `users` or `submissions` collections in bulk, or another student's
  documents, no matter what a client claims about its own role.
- An account present in `instructorAllowlist` can read all `users` and
  `submissions`.

If you add a new rule, add a test for both the allowed and the denied case —
a rules file with no failing test for the thing it's supposed to block is
not verified.
