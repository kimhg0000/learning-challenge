# Integration tests

Drive the real `FirebaseBackend` class (real Firebase Auth/Firestore/Storage
JS SDK calls, real `firestore.rules`/`storage.rules`) against the Firebase
Local Emulator Suite — not just the rules in isolation (see `tests/rules`),
and not the app's UI. This is where three real production-breaking bugs were
actually first found (documented in `tests/rules/README.md`); the rules
tests were then extended to cover them directly too.

## Running

Requires the same JDK 21+ as `tests/rules` (see that folder's README).

```
npm run integration:test
```

## What's covered

- `submission-flow.test.ts`: a double-click race (two concurrent
  `submitWeek()` calls for the same week never both succeed — exactly one
  document ends up stored); a straightforward accidental resubmit is
  rejected without duplicating data; an upload rejected by `storage.rules`
  (oversized/wrong content type) leaves **no** Firestore document at all;
  after a failed upload, an immediate retry for the same week succeeds.
- `scale.test.ts`: seeds 100 students × up to 15 weeks (~1,300+ submissions,
  an 85% completion rate) directly into the emulator, then measures the
  real instructor-dashboard read (`adminListStudents` +
  `adminListAllSubmissions`) and the real `buildExcelRows()` Excel
  row-builder over that full dataset — logging actual timings and asserting
  generous ceilings (catches an accidental O(n²) or per-row network call
  regression; the local-emulator numbers themselves aren't meaningful
  latency predictions for a real, networked Firestore project). Also checks
  a lone 101st student's own data is fully isolated from the other 100's.

## Why the rules are "relaxed" here, and what that does/doesn't mean

`helpers.ts`'s `setupIntegrationRules()` pushes the real `firestore.rules`
and `storage.rules` files to the emulator with exactly one change: the
Mon–Sun calendar week-window check is relaxed to "any real time is fine, as
long as the week number is 1–15". The emulator's `request.time` is the real
host clock and cannot be mocked, and the real calendar is a fixed
2026-09-07..2026-12-20 range — so a suite meant to run correctly regardless
of what day it actually is (before, during, or after that range) can't also
exercise the exact-date-window rule at the same time. That exact window
logic already has its own exhaustive, unmodified-rules test coverage in
`tests/rules/firestore.rules.test.ts`. Everything else here — ownership,
idempotency, immutability, semester/id matching, instructor allowlist, feed
anonymity, Storage size/type checks — is the untouched production rule.
