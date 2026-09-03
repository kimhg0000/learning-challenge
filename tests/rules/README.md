# Security rules tests

These tests exercise `firestore.rules` and `storage.rules` against the real
rules engine via the Firebase Local Emulator Suite. **Executed and passing**
(36 tests) — the environment this project was built in initially had no Java
runtime, but a JDK was installed specifically to run these for real; see
`npm run rules:test` below. Three real bugs were found and fixed this way
that no amount of reading the rules file would have caught:

- The `users/{uid}` create/update rule required every account's `studentId`
  to match `^[0-9]{7}$` unconditionally — including instructor accounts,
  which legitimately have no student id (`''`). This made it impossible to
  ever create a real instructor profile document at all. Fixed by only
  requiring the 7-digit format for `role: 'student'`.
- The initial `goalVersions/1` document is created in the *same batch* as
  its parent `users/{uid}` document (see `FirebaseBackend.completeOnboarding`).
  `get()` inside a security rule always sees the database as it was
  *before* the whole batch commits, so the cross-document sequence check
  (`version == get(users/{uid}).currentGoalVersion + 1`) failed for every
  brand-new student, because the parent document didn't exist yet from the
  rule engine's point of view. Fixed by validating version 1 as a literal
  instead of via that cross-document check (every later edit still uses it).
- `submissions` could never be `list`-queried by a student via
  `where('userId','==',uid)` — Firestore evaluates a `list` rule once for
  the whole query, without per-document access to `resource.data`, so
  "allow list if resource.data.userId == request.auth.uid" cannot actually
  be expressed for a top-level collection query. This would have broken
  every student's own "나의 챌린지 기록" screen in production. Fixed by
  having a student fetch their (at most 15) submissions by directly
  `get()`-ing each week's fully deterministic document id instead — see
  `FirebaseBackend.getMySubmissions()`.

## Running them

1. Install a JDK 21+ (e.g. `winget install Microsoft.OpenJDK.21` on Windows,
   or `brew install openjdk@21` on macOS — firebase-tools refuses older
   JDKs). Make sure `java` is on `PATH`.
2. `npm run rules:test`

That script runs `firebase emulators:exec --project demo-learning-challenge --only firestore,storage,auth "vitest run --config tests/rules/vitest.rules.config.ts"`,
which boots the emulators, points the tests at them, runs once, and tears
them down. No real Firebase project or network access is required — the
emulators are fully local. The `--project demo-learning-challenge` flag
matters: `storage.rules`'s cross-service `firestore.exists()` calls resolve
against the CLI-invoked project, not whatever project id a test's own
`initializeTestEnvironment()` call declares — see the comment at the top of
`firestore.rules.test.ts` for the full explanation (this was itself a
debugging dead-end worth documenting so it isn't rediscovered the hard way).

## What's covered

- A student can read/write only their own `users/{uid}` document, never
  another student's; cannot self-promote to `role: 'instructor'`; cannot
  change `characterType` (permanent per-account binding) or `semesterId`
  after signup.
- An allowlisted instructor CAN create their own `users/{uid}` document
  with `role: 'instructor'` (the actual regression covered above).
- A student cannot `list` the `users` or `submissions` collections; CAN
  `get()` their own not-yet-submitted week (returns not-found, not
  permission-denied — what `getMySubmissions()` relies on); CANNOT `get()`
  a non-existent id under another student's uid prefix.
- A submission can only be created inside its own week's Mon–Sun window
  (both a too-early and a too-late attempt are rejected), and only with
  `serverCreatedAt` forced equal to `request.time` (a client can never
  backdate/forward-date a submission to land inside a favorable window).
- A second submission for the same student+week/semester is rejected
  (idempotency); a submission can never be updated or deleted once created;
  a student cannot file a submission under another student's uid; a
  submission id claiming a different semester than its own `semesterId`
  field is rejected.
- A `feedPosts` document can only be created alongside a real private
  submission the caller already owns, and only with fields on the allowed
  list (no `uid`/`email`/`name`/`studentId` can be smuggled in); readable by
  any signed-in user.
- An account not present in `instructorAllowlist` can never read the
  `users` or `submissions` collections in bulk, or another student's
  documents, no matter what a client claims about its own role; can only
  check membership for *their own* email, never enumerate the allowlist;
  cannot write to `instructorAllowlist` at all (console-only, by design).
- An account present in `instructorAllowlist` can read all `users` and
  `submissions`, and read any student's proof photo in Storage.
- Storage: a student can upload/read only their own proof photo (namespaced
  by semester); non-image and oversized uploads are rejected; feed photos
  are writable/readable by any signed-in user; every other path is denied.

If you add a new rule, add a test for both the allowed and the denied case —
a rules file with no failing test for the thing it's supposed to block is
not verified. See also `tests/integration/`, which drives the real
`FirebaseBackend` class (not just raw rules) against the same emulator, and
is where the three bugs above were actually first noticed.
