import { readFileSync } from 'node:fs';
import { tinyPngBlob } from '../fixtures/tinyPng';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { FirebaseBackend } from '../../src/backend/firebaseBackend';
import type { CharacterType, GoalSettings, UserProfile } from '../../src/types';

export const INTEGRATION_PROJECT_ID = 'demo-learning-challenge';

/**
 * Pushes the REAL firestore.rules / storage.rules to the emulator project
 * that FirebaseBackend({useEmulator:true}) connects to, with exactly one
 * change: the Mon-Sun calendar week-window check is relaxed to "any real
 * time is fine, as long as the week number is 1-15".
 *
 * Why: the emulator's request.time is the real host clock and cannot be
 * mocked (see tests/rules for the same constraint), and the real calendar
 * is fixed to 2026-09-07..2026-12-20. That exact window logic is already
 * exhaustively tested against the real dates in
 * tests/rules/firestore.rules.test.ts. This integration suite exists to test
 * a DIFFERENT thing — FirebaseBackend's application-level behavior (upload-
 * then-write ordering, concurrent-submit race safety, upload-failure
 * handling, read/query shape at scale) — which must hold at any point in
 * time the suite happens to run, not only during the live semester. Every
 * other rule (ownership, semester/id matching, immutability, instructor
 * allowlist, feed anonymity, storage size/type checks) is the untouched
 * production rule.
 */
export async function setupIntegrationRules(): Promise<void> {
  const realFirestoreRules = readFileSync('firestore.rules', 'utf8');
  const realStorageRules = readFileSync('storage.rules', 'utf8');

  const relaxedFirestoreRules = realFirestoreRules.replace(
    /function isWithinWeekWindow\(week\) \{[^}]*\}/,
    'function isWithinWeekWindow(week) { return isValidWeekNumber(week); } // relaxed for tests/integration only, see helpers.ts',
  );
  if (relaxedFirestoreRules === realFirestoreRules) {
    throw new Error('setupIntegrationRules: isWithinWeekWindow pattern not found — firestore.rules must have changed shape; update the regex in tests/integration/helpers.ts');
  }

  const testEnv = await initializeTestEnvironment({
    projectId: INTEGRATION_PROJECT_ID,
    firestore: { rules: relaxedFirestoreRules, host: '127.0.0.1', port: 8080 },
    storage: { rules: realStorageRules, host: '127.0.0.1', port: 9199 },
  });
  // cleanup() only closes the SDK app instances rules-unit-testing created
  // for its own authenticatedContext()/unauthenticatedContext() helpers
  // (unused here) — it does NOT revert the rules just pushed to the project,
  // which stay in effect for every FirebaseBackend({useEmulator:true})
  // instance the rest of this suite creates.
  await testEnv.cleanup();

  // FirebaseBackend.submitWeek() also runs a CLIENT-side pre-check
  // (isWithinSubmissionWindow) against the real 2026-09-07..2026-12-20
  // calendar using the real wall clock, before ever talking to Firestore.
  // The rule-side relaxation above doesn't touch that client check, so it
  // would reject every submission whenever this suite runs outside the real
  // semester dates. Point it at a fixed instant inside week 1's real window
  // instead — see utils/date.ts now(). This has no effect on what a real
  // student's app does (VITE_PROTOTYPE_MODE=false builds never set this).
  globalThis.__QUEST_TEST_NOW = '2026-09-09T12:00:00+09:00';
}

const DEFAULT_GOAL: GoalSettings = {
  goalText: '도서관에서 전공책을 60분 읽고 핵심 내용을 3줄로 정리한다.',
  weekday: 3,
  startTime: '19:00',
  duration: 60,
};

// firestore.rules now enforces one studentId per semester (studentIdRegistry)
// — createStudent() is called by dozens of tests across several files that
// share one emulator project for the whole run (fileParallelism:false, no
// clearFirestore between files; see scale.test.ts). A fixed default id would
// collide the moment more than one such call happens; a simple in-module
// counter isn't enough either, since vitest gives each test FILE its own
// module instance (so the counter itself doesn't stay shared across files).
// A random 7-digit id keeps collisions negligible across the whole run
// without every test needing to invent its own unique id.
function nextDefaultStudentId(): string {
  return String(1000000 + Math.floor(Math.random() * 9000000));
}

/** Signs up a brand-new student (real Auth emulator account + real completeOnboarding()) and returns the ready backend + uid + profile. */
export async function createStudent(
  email: string,
  overrides: { studentId?: string; characterType?: CharacterType; goal?: GoalSettings; name?: string } = {},
): Promise<{ backend: FirebaseBackend; uid: string; profile: UserProfile }> {
  const backend = new FirebaseBackend({ useEmulator: true });
  await backend.signUpEmail(email, 'password123');
  const uid: string = await new Promise((resolve) => {
    const unsub = backend.onAuthChange((user) => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
  });
  const profile = await backend.completeOnboarding(uid, email, {
    name: overrides.name ?? '테스트 학생',
    studentId: overrides.studentId ?? nextDefaultStudentId(),
    characterType: overrides.characterType ?? 'rabbit',
    goal: overrides.goal ?? DEFAULT_GOAL,
  });
  return { backend, uid, profile };
}

export function tinyJpegBlob(): Blob {
  return tinyPngBlob();
}

export function oversizedNonImageBlob(): Blob {
  // Fails storage.rules' isReasonableImage() on BOTH counts (not an image,
  // and — once padded — over the 20MB cap), simulating a realistic
  // upload-rejected-by-the-server failure rather than a network error.
  return new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'application/octet-stream' });
}

/**
 * Runs `fn` with a Firestore handle to the integration project that bypasses
 * security rules entirely — for bulk-seeding test fixtures directly (e.g.
 * hundreds of submission documents) without paying for hundreds of real
 * Storage uploads + transactions through submitWeek(). Real app code paths
 * (FirebaseBackend.submitWeek, admin queries, buildExcelRows) are exercised
 * separately and are what each test actually asserts on.
 */
export async function withRulesDisabled<T>(fn: (firestore: import('firebase/firestore').Firestore) => Promise<T>): Promise<T> {
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: INTEGRATION_PROJECT_ID });
  try {
    // testEnv.withSecurityRulesDisabled() awaits its callback but discards
    // whatever it returns, so fn's result is captured into this closure
    // variable instead of relied on as a return value.
    let result!: T;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      result = await fn(ctx.firestore());
    });
    return result;
  } finally {
    await testEnv.cleanup();
  }
}

/**
 * Same as withRulesDisabled, but for Storage — used to check whether a photo
 * was actually deleted. Must pass the SAME bucket name FirebaseBackend's
 * emulator branch uses ('demo-learning-challenge.appspot.com') explicitly —
 * ctx.storage()'s own default bucket is `gs://${projectId}` with no
 * ".appspot.com" suffix, a different (empty) bucket in the Storage
 * emulator's eyes, which silently makes every file look missing.
 */
export async function withStorageRulesDisabled<T>(fn: (storage: import('firebase/storage').FirebaseStorage) => Promise<T>): Promise<T> {
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({ projectId: INTEGRATION_PROJECT_ID });
  try {
    let result!: T;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      result = await fn(ctx.storage(`gs://${INTEGRATION_PROJECT_ID}.appspot.com`));
    });
    return result;
  } finally {
    await testEnv.cleanup();
  }
}

/** Signs up a brand-new instructor (real Auth emulator account, allowlisted via a rules-bypassing write, then ensureInstructorProfile()) and returns the ready backend + uid. */
export async function createInstructor(email: string): Promise<{ backend: FirebaseBackend; uid: string }> {
  const backend = new FirebaseBackend({ useEmulator: true });
  await backend.signUpEmail(email, 'password123');
  const uid: string = await new Promise((resolve) => {
    const unsub = backend.onAuthChange((user) => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
  });
  const { doc, setDoc } = await import('firebase/firestore');
  await withRulesDisabled(async (firestore) => {
    await setDoc(doc(firestore, 'instructorAllowlist', email.toLowerCase()), { note: 'test' });
  });
  await verifyEmulatorEmail(backend, uid, email);
  await backend.ensureInstructorProfile(uid, email, '교수자');
  return { backend, uid };
}

export async function verifyEmulatorEmail(backend: FirebaseBackend, uid: string, email: string) {
  // Hard-coded loopback and demo project: this helper cannot alter real Auth.
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!response.ok) throw new Error(`Auth emulator verification failed: ${response.status}`);
  await backend.signOutUser();
  await backend.signInEmail(email, 'password123');
}

/** sha256Hex of a string, matching FirebaseBackend's private feedId derivation (feedId = sha256(subId)). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
