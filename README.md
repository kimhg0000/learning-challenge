# 15-Week Learning Challenge

A mobile-first PWA for a university course: each student commits to one
concrete behavioral goal and checks in once a week, for 15 weeks
(2026-09-07 – 2026-12-20), with a proof photo and a short reflection.
Students track their own streak, a punctual-submission badge, and a growing
character; the instructor gets a real-time dashboard and a semester-end
Excel export.

Real backend: **Firebase** (Authentication, Firestore, Storage). There is no
`localStorage`-only mode for real use — see "Prototype vs. production" below
for the one exception (a fully separate demo mode for classroom walkthroughs
before a Firebase project exists).

## Stack

Vite + TypeScript (no framework — see "Why not React" below) + Firebase
Auth/Firestore/Storage + `vite-plugin-pwa` + SheetJS (`xlsx`) for the Excel
export + Vitest for tests. Deploys to Netlify; Firestore/Storage security
rules deploy via the Firebase CLI.

### Why not a React/full framework rewrite

The original app was a single 900-line `index.html` with a well-tuned mobile
UI already built into hand-written HTML/CSS. Re-deriving all of that as JSX
would have been pure rewrite risk (regressions in a UI that already works)
for no functional benefit. Instead this project keeps the same DOM structure
and CSS, and modularizes the *logic* into small, typed, testable TypeScript
files under `src/` — the actual maintainability problem (one giant
inline `<script>`) is what's fixed. Auth/DB/Storage access is fully isolated
behind `src/backend/types.ts` (`Backend` interface), so swapping frameworks
later, if ever needed, does not require touching business logic.

## Project layout

```
src/
  constants.ts        Program calendar, growth stages, character list
  config.ts            Reads .env, decides prototype vs production
  types.ts             Shared TypeScript types (UserProfile, Submission, ...)
  utils/               Pure, unit-tested logic (dates, growth, punctuality, validation)
  backend/
    types.ts           Backend interface — the only thing the UI talks to
    firebaseBackend.ts Real implementation (Auth + Firestore + Storage)
    localBackend.ts    IndexedDB-backed stand-in, prototype mode ONLY
  admin/excelExport.ts Pure row-building logic + SheetJS file writer
  ui/                  DOM rendering and event wiring, one file per screen
tests/
  unit/                Vitest, no network/emulator needed
  rules/               Firestore/Storage security rules tests (needs emulators — see tests/rules/README.md)
firestore.rules / storage.rules / firestore.indexes.json / firebase.json
```

## Local setup

```
npm install
cp .env.example .env      # keep VITE_PROTOTYPE_MODE=true to try it with no Firebase project yet
npm run dev
```

With `VITE_PROTOTYPE_MODE=true`, the login screen shows "체험하기" buttons
that log you in as a fake student/instructor backed by this browser's
IndexedDB only — no Firebase project needed. Good enough to demo the whole
app in class before real infrastructure exists, but this data never mixes
with real student data and is not a substitute for it.

## Setting up the real Firebase project (production)

1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com).
   Spark (free) plan is sufficient — nothing here requires Cloud Functions
   or Blaze billing.
2. Enable **Authentication** → Email/Password, and Google.
3. Enable **Firestore** (production mode) and **Storage**.
4. Add a Web app in Project Settings and copy its config values into `.env`
   (see `.env.example`). Set `VITE_PROTOTYPE_MODE=false`.
5. Deploy the security rules and indexes:
   ```
   npx firebase login
   npx firebase use --add        # pick your project, give it an alias
   npx firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
6. **Instructor setup (manual, on purpose):** open Firestore in the Console
   and create a document at `instructorAllowlist/<instructor's lowercase email>`
   (any field, e.g. `{ "note": "course instructor" }`). Whoever's email is
   listed there is treated as an instructor everywhere in the app —
   this is checked by the security rules themselves (server-side), not by
   any code the browser can influence. There is deliberately no UI to add an
   instructor from inside the app.
7. Set the same `VITE_FIREBASE_*` values (and `VITE_PROTOTYPE_MODE=false`)
   as environment variables in Netlify (Site settings → Environment
   variables) — `.env` is git-ignored and never deployed automatically.

## Testing

```
npm test              # unit tests — pure logic, no network, runs anywhere
npm run rules:test     # Firestore/Storage security rules, needs Java + Firebase CLI (see tests/rules/README.md)
npm run build          # typecheck + production build
```

`npm run rules:test` boots the Firebase Local Emulator Suite, runs the rules
tests against it, and tears it down — no real project or network access
needed, just a local JDK 17+.

## Data model (Firestore)

- `users/{uid}` — profile + the *currently active* goal (denormalized for
  fast reads). `role` is present for display only; real authorization never
  trusts it (see below).
- `users/{uid}/goalVersions/{n}` — append-only version history. Editing a
  goal never overwrites this; it adds version `n+1` and bumps
  `users/{uid}.currentGoalVersion` in one atomic batch.
- `submissions/{uid}_w{week}` — one document per student per week, by
  construction (the deterministic ID *is* the de-dup mechanism). Immutable
  once created. Carries a full snapshot of the goal that was active at
  submission time (`goalSnapshot`), so editing a goal later never changes
  how a past week is displayed.
- `feedPosts/{randomId}` — the anonymous feed. Contains no uid, email, name,
  or student ID — only `anonName` (a nickname generated once at signup and
  stored on the profile, never derived from the uid at read time).
- `instructorAllowlist/{email}` — existence of a document at a given
  lowercase email = that account is an instructor. Never written by any
  client role; the course owner manages it directly in the Firebase
  Console.

## Authorization model

There is no custom-claims Cloud Function (that needs Blaze billing). Instead,
"is this caller an instructor" is answered by a Firestore security rule that
checks `exists(/instructorAllowlist/{callerEmail})` — evaluated on Google's
servers as part of every read/write rule, not something a client can spoof.
A student cannot self-promote (`role: 'instructor'` is rejected by
`firestore.rules` unless the allowlist check passes), cannot read another
student's profile or submissions, and cannot edit or delete a submission
once created (audit-trail immutability).

## Prototype vs. production

`VITE_PROTOTYPE_MODE` decides everything:

| | Prototype (`true`) | Production (`false`) |
|---|---|---|
| Backend | `LocalBackend` (IndexedDB, this browser only) | `FirebaseBackend` (real Auth/Firestore/Storage) |
| Login | 체험하기 buttons | Google / email+password only |
| Week/date rules | Bypassable via a "테스트할 주차" picker | Real Mon 00:00–Sun 23:59 KST windows, enforced client-side AND by `firestore.rules` |
| Test-photo generator, punctual-badge override checkbox | Shown | Not rendered at all |

Set `VITE_PROTOTYPE_MODE=false` in Netlify before the real semester starts.
The prototype UI branches are static `if (PROTOTYPE_MODE)` checks, so the
bundler removes that code from a production build rather than just hiding it.

## Known limitations (see also the session's final report)

- No Cloud Functions means a few cross-document invariants (e.g. "a goal
  version bump always has a matching history document") are enforced by
  this app's own client code and Firestore batch atomicity, not by security
  rules alone. A student would have to hand-craft raw SDK calls to corrupt
  only their *own* goal-history display this way — low severity, documented
  rather than solved with added infrastructure cost.
- If a photo upload succeeds but the immediately-following Firestore write
  fails (rare — a network drop in that exact instant), the photo is orphaned
  in Storage with no document pointing at it. Harmless (a few KB, never
  shown anywhere) and not worth a cleanup job at this scale.
