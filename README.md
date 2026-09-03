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
  integration/         Real FirebaseBackend against the emulator (races, upload failures, 100x15 scale)
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

## Staging environment (real Firebase, before the real semester starts)

Emulator tests prove the rules and app code are correct; they don't prove a
real phone can actually reach a real Firebase project over the internet. For
that, this project uses a **second, fully separate Firebase project**
(`learning-challenge-staging`) plus a **dedicated, stable Netlify site**
(`https://learning-challenge-staging.netlify.app` — not a rotating draft
URL), so real end-to-end device testing never touches production
Authentication, Firestore, Storage, rules, or student data, and never
requires relaxing the production date rule.

The only difference between the staging and production security rules is
the semester calendar — enforced by generating `firestore.staging.rules`
from the real `firestore.rules` and verifying byte-for-byte equality outside
the two calendar functions:

```
node scripts/generate-staging-rules.mjs        # writes firestore.staging.rules
npm run staging:deploy-rules                    # deploys it + indexes + storage.rules to the staging project
```

`storage.rules` has no date logic at all, so the exact same file deploys to
both projects unchanged.

### One-time setup (mirrors "Setting up the real Firebase project" above, on a second project)

1. Create a second Firebase project (e.g. `learning-challenge-staging`),
   enable the same Authentication providers, Firestore (same region as
   Storage), and Storage.
2. Add a Web app there, copy its config into `.env.staging` (see
   `.env.staging.example`) — a **completely different project** from `.env`.
   Also set `VITE_PROGRAM_START`/`VITE_PROGRAM_END` a week or two before
   "now" (not exactly "now"), so staging always has a genuinely expired
   week, a genuinely current one, and future ones to test all three
   date-window behaviors at once. Regenerate the rules (above) to match.
3. `.firebaserc` already has a `staging` alias pointing at this project —
   `npx firebase deploy --project staging --config firebase.staging.json ...`
   (or just `npm run staging:deploy-rules`).
4. Add the instructor's email as its own `instructorAllowlist` document in
   the **staging** project's Firestore too — it is a separate database from
   production, so this is a separate manual step there.
5. Create a dedicated Netlify site for staging and deploy the staging build
   to it directly (bypassing Netlify's own build step, which would
   otherwise re-run `npm run build` from `netlify.toml` — i.e. a
   **production**-mode build — and silently overwrite the staging config
   you just built locally):
   ```
   npm run build:staging
   npx netlify deploy --site <staging-site-id> --dir=dist --prod --no-build
   ```
6. Add the staging Netlify domain (`learning-challenge-staging.netlify.app`)
   to the **staging** Firebase project's Authentication → Settings →
   Authorized domains (once — it's a stable URL, so this never needs
   redoing on subsequent deploys, unlike a draft URL).

From then on, every real device test flow — new account, Google or
email/password login, photo capture, submission, punctual badge, goal
v1→v2 with snapshot preservation, logout/login, instructor review, Excel
export — runs against real Firebase at that fixed URL, fully isolated from
production, with production's 2026-09-07 date rule and rules file
completely untouched.

## Testing

```
npm test                 # unit tests — pure logic, no network, runs anywhere
npm run rules:test        # Firestore/Storage security rules (34 tests), needs Java 21+ + Firebase CLI
npm run integration:test  # real FirebaseBackend against the emulator — races, upload failures, 100x15 scale
npm run build             # typecheck + production build
```

Both `rules:test` and `integration:test` boot the Firebase Local Emulator
Suite, run against it, and tear it down — no real project or network access
needed, just a local JDK 21+ (`winget install Microsoft.OpenJDK.21` /
`brew install openjdk@21`). `integration:test` drives the real
`FirebaseBackend` class (real Auth/Firestore/Storage SDK calls, real
security rules) the same way the deployed app does, to catch bugs pure
rules-unit-tests can't — see `tests/integration/helpers.ts` for how it
relaxes only the calendar-window check (which is separately exhaustively
tested in `tests/rules`) so the suite works regardless of what day it's
actually run.

You can also point an interactive `npm run dev` at the same local emulator
instead of the IndexedDB prototype backend: run `npm run rules:emulators` in
one terminal, then in another, `VITE_PROTOTYPE_MODE=false` +
`VITE_USE_FIREBASE_EMULATOR=true` in `.env` and `npm run dev` — this exercises
the real, rules-enforced student/instructor flow end to end on localhost,
with zero real Firebase project required.

## Data model (Firestore)

Every document below also carries a `semesterId` (see `constants.ts
SEMESTER_ID`, e.g. `"2026-fall"`). All admin/feed queries filter by the
*current* semester, so re-running this app for a later semester never mixes
a past semester's roster or submissions into the current dashboard/feed —
see "Running this for a new semester" below.

- `users/{uid}` — profile + the *currently active* goal (denormalized for
  fast reads). `role` and `characterType` are permanent once set (rules
  reject any change); `role` is also never trusted for authorization on its
  own — see "Authorization model" below.
- `users/{uid}/goalVersions/{n}` — append-only version history. Editing a
  goal never overwrites this; it adds version `n+1` and bumps
  `users/{uid}.currentGoalVersion` in one atomic batch.
- `submissions/{uid}_{semesterId}_w{week}` — one document per student per
  semester per week, by construction (the deterministic id *is* the de-dup
  mechanism, and re-verified inside a transaction against concurrent
  double-submits). Immutable once created. Carries a full snapshot of the
  goal that was active at submission time (`goalSnapshot`), so editing a
  goal later never changes how a past week is displayed. A student fetches
  their own submissions by directly `get()`-ing all 15 possible week ids
  rather than running a `where(userId==)` query — Firestore can't express
  "list only documents where a field matches the caller" as a security rule
  for a top-level collection query, so `list` on this collection is
  instructor-only and a student's own reads go through the ordinary `get`
  rule (owner-or-instructor) instead, once per week id.
- `feedPosts/{randomId}` — the anonymous feed. Contains no uid, email, name,
  or student ID — only `anonName` (a nickname generated once at signup and
  stored on the profile, never derived from the uid at read time).
- `instructorAllowlist/{email}` — existence of a document at a given
  lowercase email = that account is an instructor. Never written by any
  client role; the course owner manages it directly in the Firebase
  Console.

## Running this for a new semester

1. Pick a new value for `SEMESTER_ID` in `src/constants.ts` (e.g.
   `"2027-spring"`), and update `PROGRAM_START`/`PROGRAM_END` there.
2. Update the matching `currentSemester()` and `programStart()` in
   `firestore.rules` (and the calendar constant in `storage.rules` if you
   changed it), then `npx firebase deploy --only firestore:rules,storage`.
3. Deploy the app with the new constants. New signups get the new
   `semesterId` automatically; nothing about a past semester's data is
   touched or deleted.
4. To let the instructor look at a *past* semester's roster/submissions:
   the data is all still there (Firestore never deletes it), queryable by
   filtering on the old `semesterId` directly in the Firebase Console, or
   by temporarily building with the old `SEMESTER_ID`. There's no
   in-app semester switcher yet — see the redesign backlog.
5. Before wiping anything: export a final Excel from the admin dashboard,
   and consider a Firestore export (`gcloud firestore export`) as a durable
   backup. Storage photos for a past semester can simply be left in place
   (a full semester's worth of compressed proof photos is a few hundred MB
   at most — well under Spark's free tier) unless you specifically want to
   reclaim the space.

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
The actual production/prototype gate is `src/ui/productionGuard.ts`, which
permanently removes every prototype-only DOM element (체험하기 buttons, the
test-week picker, the test-photo generator, the punctual-badge override
checkbox) from the page the moment the app boots when
`VITE_PROTOTYPE_MODE=false` — not just CSS-hiding them, which a student could
undo from devtools. Verified by loading a `VITE_PROTOTYPE_MODE=false` build
and confirming `document.getElementById(...)` returns `null` for all four.
(The `LocalBackend` class's *code* still ships in the production JS bundle —
esbuild can't prove the runtime env check dead — but it's inert: nothing in
a production build ever constructs or calls it.)

## Known limitations

- No Cloud Functions means one cross-document invariant isn't enforced by
  security rules alone: a student's own `users/{uid}.currentGoalVersion`
  could in principle be bumped via a hand-crafted SDK call without also
  creating the matching `goalVersions` document in the same batch (the app's
  own code always does both atomically; only a deliberately adversarial
  direct API call could skip it). The blast radius is limited to that
  student's own goal-history display — it can't affect anyone else's data,
  forge a submission, or escalate privilege — so this is documented rather
  than solved with added infrastructure cost.
- If a photo upload succeeds but the immediately-following Firestore write
  fails (rare — a network drop in that exact instant), the photo is orphaned
  in Storage with no document pointing at it. Verified (via
  `tests/integration`) that the reverse — a Firestore doc with no photo —
  can never happen, since the write only happens after upload succeeds.
  Harmless (a few hundred KB, never shown anywhere) and not worth a cleanup
  job at this scale.
- No in-app UI yet to let an instructor browse a *past* semester once a new
  one starts (the data model supports it — see "Running this for a new
  semester" — `adminListStudents`/`adminListAllSubmissions` already accept
  an optional `semesterId`; only the picker UI is missing). Tracked in the
  redesign backlog.
