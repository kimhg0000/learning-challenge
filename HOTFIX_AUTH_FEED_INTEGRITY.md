# Auth / Feed / Integrity operations

Branch: `hotfix/auth-feed-integrity`, based on `033bf80d20219c68ee7e77d62c39402137d5ba61`.
Production project: `week-learning-challenge`; production semester: `2026-fall`.
This implementation session permits **staging only**. Commands below describing
production are a future runbook, not authorization to execute them now.

## Behavior

- Google uses popup only, synchronously reached from the click handler. Closing
  or cancelling a popup is silent. Blocked popup and network failures are distinct.
  Email/password methods and the instructor → consent → onboarding routing stay intact.
- Every awaited post-login read checks the captured session before mutating UI/state.
  A timed-out run is retired before retry; logout invalidates immediately.
- Client uploads original compressed bytes once. An SHA-256 metadata value allows
  the same bytes to be reused after a failed Firestore commit. There is no canvas,
  pixel decoding, preview or client compression. Old orphan uploads without a hash
  require investigation; they are deliberately never replaced automatically.
- Server uses sharp 0.34.5, JPEG quality 78, inside 1200×1200, no enlargement,
  EXIF auto-rotation, white transparency background and stripped EXIF/GPS/ICC.
  Compressed input ≤20 MiB; decoded image ≤64 Mi pixels; processing timeout 30s.
  Function: Node 22, 1 GiB, concurrency 1, maxInstances 5, timeout 60s.
- HEIC/HEVC is **not an advertised supported format**. Prebuilt libheif presence
  does not prove HEVC decoding. Unsupported/corrupt/oversized input isolates Feed
  failure; the successful private submission survives, with no original fallback.
- `feedPhotos/{sha256(submissionId)}.jpg` stays compatible with deletion and old URLs.
  Bytes and token are atomically created with `ifGenerationMatch: 0`. Contending
  invocations can encode concurrently, but only one final object wins; losers read
  its token. Existing marked objects skip encoding. Firestore uses create-only.
- Student Feed/Home and instructor Feed/admin/history cards use feedPhotos only.
  Missing thumbnails show a placeholder; original URLs remain in evidence detail.
  Instructors open that detail with the history card's “원본 증빙 보기” button;
  simply opening a roster or history does not request the private original.
  Existing feedPhotos remain large until separately approved backfill. The client
  adds a version query key to avoid reusing pre-rollout browser cache entries.
- Storage: owner create-only private uploads; all Feed client writes denied.
  Firestore: submitted-only field schema, current week/semester/document identity,
  server timestamp, own photo path/URL, and exact current profile goal snapshot.
  A stale goal from another tab is rejected; refresh profile before retrying.
- Instructor access requires allowlist membership AND verified email in client,
  both Rules sets and privileged deletion Function.
- Deletion keeps the profile until Auth deletion succeeds, tolerates already-deleted
  Auth on retry, removes privacyConsent/record and all UID-owned studentIdRegistry
  entries, and commits the audit with the Firestore deletion batch.

## Validation commands

Use Node 22 on PATH for Functions/emulators. Frontend also builds on Node 24.

```
npm test
npm run rules:test
npm run integration:test
npm --prefix functions run build
npm run typecheck
npm run build
```

Rules/integration always use `demo-learning-challenge`. Integration relaxes only
the calendar window, so it can run outside the semester. Real-window Rules tests
also check the actual clock. Valid images replace the old 4-byte JPEG fixture.

## Staging

```
node scripts/generate-staging-rules.mjs
firebase deploy --project learning-challenge-staging --config firebase.staging.json --only functions:publishFeedPost,functions:deleteStudentAccount,firestore:rules,storage
npm run build:staging
netlify deploy --site dc7b14eb-1d1e-4e4d-bcaa-b8d6557b5640 --dir dist --prod --no-build
node --env-file=.env.staging --import tsx scripts/verify-auth-feed-staging.ts --run
```

The explicit Netlify ID is `learning-challenge-staging.netlify.app`; the folder's
default `.netlify/state.json` points at a DIFFERENT site. Never omit `--site` or
allow Netlify to rebuild in production mode. `--prod` here updates the fixed
**staging** Netlify address, not Cloudflare Pages.

The verification script refuses any project except `learning-challenge-staging`,
uses unique disposable accounts and a separate disposable backfill semester, and
cleans up only its own IDs. It reuses the existing Firebase CLI credential without
printing tokens. Backups/results are under the system temp directory. Google OAuth
still requires real interactive instructor/student login; emulator/email tests
cannot prove iOS Safari or installed-PWA behavior.

## Backfill: separate approval required for production

Build first: `npm --prefix functions run build`. The CLI uses Application Default
Credentials; use the least privileges necessary for the explicit project/bucket.
Default is dry-run and does not create local files, backups or Storage writes:

```
node functions/lib/backfillCli.js --project=week-learning-challenge --semester=2026-fall --bucket=week-learning-challenge.firebasestorage.app
```

Verify the bucket name against actual configuration before using that example.
Applying additionally requires all of:
`--apply --confirm-project=<same-project> --backup-dir=<restricted-local-directory>`.
Only `2026-fall` is allowed for the named production project. Never put backup
directories in git: manifests contain download tokens and original Feed bytes.

The utility pages real feedPosts by semester and document-ID cursor (50 per page),
validates hash/path/week/bucket/token, and reads current generation/metageneration,
size and checksums. Already marked JPEG objects skip. Writes are sequential and
conditional on BOTH generation and metageneration. No private original is read or
written. Missing objects/posts, mismatches and corrupt images are isolated failures;
a run with failures exits nonzero and may be safely rerun.

Before each overwrite it durably writes `<feedId>-<generation>.bin` and `.json`,
including all prior metadata/tokens and SHA-256. It appends results to manifest.jsonl.
Replacement metadata records source generation/hash so even a crash after overwrite
but before result logging can be reconciled with the prepared backup.

Rollback one object using the same project/semester/bucket, `--apply`, confirmation,
backup directory and `--restore=<path-to-prepared-json>`. Restoration checks backup
SHA-256, existing post, existing object and matching backfill source markers, then
uses current generation/metageneration preconditions. It never recreates a deleted
object or overwrites an unrelated replacement. Restoring high-resolution Feed
bytes can reintroduce the performance problem.

## Future production order and risks

1. Complete real instructor/student Google, email, iOS Safari/PWA checks in staging.
   Resolve any staging failure before approving production. Retain current deployed
   artifacts/rules and verify production project/bucket/semester explicitly.
2. Deploy only the two Functions to the production project (Node 22). No Rules or
   data migration during this step. Check server thumbnail creation on an authorized
   test submission; no actual student records may be altered for testing.
3. Merge the reviewed frontend only when production deployment is approved: main
   push automatically triggers Cloudflare Pages. Confirm the new PWA app shell and
   ask active users to accept the update before tightening Storage Rules.
4. Deploy Firestore and Storage Rules explicitly to production. Google instructors
   must have verified-email claims. Check normal submission and access rejection.
5. Independently approve current-semester backfill: dry-run inventory → review
   failures/token mismatches → restricted backups → small canary batch/cohort →
   full paged run → inspect dimensions, bytes, token URL and private-byte preservation.
   Stop upon conflicts and investigate; never force an unconditional overwrite.

For a canary, use a disposable staging semester first, then `--max-records=5`
to bound a separately approved production run to its first five records. Remove
that option only after reviewing the canary; the full run skips marked records.

Old client (`81d3edb^`) uploads private → commits Firestore → tries Feed upload
three times → warns and returns success. Denying Feed client writes therefore
preserves its submission but leaves no Feed. Offline old PWAs can persist until
reloaded. Legacy orphan photos without SHA metadata and other-tab stale goal data
can require instructor assistance; never reopen overwrite permission as a remedy.

Rollback frontend via a known artifact; keep popup-only where possible. Restore a
known compatible Function build on Node 22 (Node 20 is approaching retirement).
Prefer forward fixes to restoring permissive photo-write Rules. Object rollback is
separate from code rollback and must use the guarded backup procedure above.

Remaining limits: deletion still assumes one profile semester and a Firestore batch
within its write limit. Cross-service publish/delete races are not a distributed
transaction; concurrent account deletion and publish need separate operational
coordination. Existing corrupt/missing/token-mismatched Feed records require an
explicit repair decision. No automatic repair, recreation or production migration
is performed by this hotfix.

## Recorded verification (2026-09-10 / 2026-09-11)

- Node 22.23.2: 194 unit tests, 71 Rules tests (Firestore + Storage), 41 integration
  tests passed; Functions build and frontend typecheck passed. Total 306 unique tests.
- Final instructor evidence-link change: its 28 Feed/photo UI tests passed again;
  production build and staging build passed. Existing large-bundle advisory remains.
- Real staging Functions/Rules deployed 2026-09-10. Both Functions use Node 22.
- Final frontend staging deployment:
  `https://6aa3426e072c9b0015bea3ac--learning-challenge-staging.netlify.app`;
  stable URL `https://learning-challenge-staging.netlify.app`.
- Real staging synthetic-photo E2E: original 6,878,882 bytes preserved exactly;
  JPEG thumbnail 121,825 bytes, 1200×900, image/jpeg. Repeated publish URL/token
  and Storage generation stable. Verified-email instructor access and deletion passed.
- Real GCS backfill on two disposable staging objects: dry-run changed 0; apply
  changed 2; rerun skipped 2; restore reproduced both original Feed byte sequences.
  The script cleaned up its disposable accounts/documents/objects afterward.
  Results/backups: system temp `learning-challenge-hotfix/hotfix-1789022585208`.
- Synthetic fixture measurements (not a promise for all phone photographs):
  JPEG 6,878,882 → 121,825 bytes; PNG 1,521,327 → 214,113; WebP 6,705,976 → 118,498.
  Average output 151,479 bytes; maximum 214,113 bytes.
- User completed real instructor Google login and confirmed the instructor dashboard.
  Browser verified instructor Feed pagination replaces with 10 cards, all using
  feedPhotos with lazy/async/low attributes; admin/history use the same paths.
- On the final `index-CnlLtghS.js` staging bundle, the instructor history's
  “원본 증빙 보기” button opened a loaded private submission image in the detail
  modal. The instructor was then logged out to prepare student Google verification.
- HEIC decoding has not been demonstrated with a real HEIC fixture in the cloud
  runtime. It remains unsupported/unverified; no original-to-public fallback exists.
- No production deployment, data write, backup/backfill, main merge or push occurred.

## Handoff qualification (2026-09-11)

- The user has no separate student Google account and explicitly requested completion
  with that check recorded as unverified. Real student Google OAuth and its subsequent
  student UI walkthrough are **not verified**. Unit/emulator coverage and the real
  staging email/password submission E2E do not substitute for that OAuth check.
- Real iPhone Safari / installed home-screen PWA behavior is also **not verified**.
  The instructor Google login and instructor UI checks used desktop Chrome.
- These gaps remain release qualifications for a separately approved production
  rollout. Staging readiness does not certify those untested environments.
- Completed suites were not repeated without a code change. The final evidence-link
  UI change was covered by the targeted 28-test rerun and both frontend builds.
- No further deployment or production operation is authorized by this handoff.

## Changed files

- Runtime/config: `firebase.json`, `firebase.staging.json`, `functions/package.json`,
  `functions/package-lock.json`.
- Rules: `firestore.rules`, `firestore.staging.rules`, `storage.rules`.
- Functions/tools: `functions/src/index.ts`, `functions/src/feedPhotos.ts`,
  `functions/src/backfill.ts`, `functions/src/backfillCli.ts`,
  `scripts/verify-auth-feed-staging.ts`.
- Backend: `src/backend/firebaseBackend.ts`, `src/backend/localBackend.ts`,
  `src/backend/types.ts`.
- UI: `src/ui/adminData.ts`, `src/ui/auth.ts`, `src/ui/privacyConsent.ts`,
  `src/ui/refresh.ts`, `src/ui/session.ts`, `src/ui/screens/admin.ts`,
  `src/ui/screens/feed.ts`, `src/ui/screens/home.ts`.
- Utilities: `src/utils/feedPhoto.ts`, `src/utils/imgFallback.ts`.
- Integration tests: `tests/integration/delete-student-account.test.ts`,
  `tests/integration/feed-consistency.test.ts`, `tests/integration/helpers.ts`,
  `tests/integration/instructor-feed-authorization.test.ts`,
  `tests/integration/publish-feed-post.test.ts`, `tests/integration/scale.test.ts`.
- Rules tests: `tests/rules/firestore.rules.test.ts`, `tests/rules/storage.rules.test.ts`.
- Unit tests/fixtures: `tests/unit/authFlow.test.ts`, `tests/unit/authRoutingOrder.test.ts`,
  `tests/unit/backfill.test.ts`, `tests/unit/feedPagination.test.ts`,
  `tests/unit/imgFallback.test.ts`, `tests/unit/photoCapture.test.ts`,
  `tests/unit/thumbnail.test.ts`, `tests/fixtures/photographic.ts`.
- Handoff: `HOTFIX_AUTH_FEED_INTEGRITY.md`.
