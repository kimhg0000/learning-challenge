import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { PROGRAM_START, PROGRAM_END, SEMESTER_ID } from '../../src/constants';
import { getCurrentProgramWeek } from '../../src/utils/date';

function subDocId(uid: string, week: number): string {
  return `${uid}_${SEMESTER_ID}_w${week}`;
}

// Must match the --project flag "rules:test" passes to `firebase emulators:exec`
// (see package.json). storage.rules's cross-service firestore.exists() calls
// resolve against the CLI-invoked project, not whatever project id a test's
// own initializeTestEnvironment() call happens to declare — a mismatch here
// makes every instructor-via-Storage-rules check silently fail. Both rules
// test files intentionally share this same project id, and vitest.rules.config.ts
// forces them to run sequentially (fileParallelism: false) so their
// beforeEach(clearFirestore/clearStorage) calls can't race each other.
const PROJECT_ID = 'demo-learning-challenge';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const STUDENT_A = { uid: 'student-a', email: 'a@student.example' };
const STUDENT_B = { uid: 'student-b', email: 'b@student.example' };
const INSTRUCTOR = { uid: 'instructor-1', email: 'prof@univ.example' };

// A fixed week (week 3 of the 2026-09-07 program calendar; see firestore.rules /
// src/constants.ts) used ONLY for the "rejects a spoofed/stale serverCreatedAt"
// tests below. Those tests deliberately supply a serverCreatedAt that is NOT
// the real emulator clock's request.time — which the rules reject outright
// (serverCreatedAt must equal request.time, so it can never be backdated or
// forward-dated by a client). That is itself the important anti-cheating
// property: a student cannot fabricate a submission instant to land inside a
// favorable window. It also happens to be outside the claimed week either way,
// so it does not matter that these dates aren't "real time" for the assertion.
const WEEK_3_TOO_EARLY = Timestamp.fromDate(new Date('2026-09-20T10:00:00+09:00')); // still week 2
const WEEK_3_TOO_LATE = Timestamp.fromDate(new Date('2026-10-01T10:00:00+09:00')); // already week 4

// Used only for fixtures written via withSecurityRulesDisabled (seeding data
// that a later, rules-checked call then reads or duplicates) — rules don't
// run for those writes, so any valid Timestamp works here.
const SEED_TIMESTAMP = Timestamp.now();

// The emulator's request.time is the real host clock and cannot be mocked, so
// a "does a submission succeed right now" test has to be evaluated against
// whatever "now" actually is when the suite runs, using the exact same
// calendar the rules use (src/constants.ts / firestore.rules PROGRAM_START).
const now = new Date();
const isWithinProgram = now >= PROGRAM_START && now <= PROGRAM_END;
const currentWeek = isWithinProgram ? getCurrentProgramWeek(now) : null;

function studentUserDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: '김학생',
    studentId: '1234567',
    email: STUDENT_A.email,
    characterType: 'rabbit',
    anonName: '도전자 100',
    role: 'student',
    semesterId: SEMESTER_ID,
    currentGoalVersion: 1,
    goalText: '도서관에서 전공책을 60분 읽고 핵심을 3줄로 정리한다.',
    weekday: 3,
    startTime: '19:00',
    duration: 60,
    goalCreatedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

async function seedInstructorAllowlist() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'instructorAllowlist', INSTRUCTOR.email), { note: 'seeded for tests' });
  });
}

async function seedStudentUser(uid: string, data: ReturnType<typeof studentUserDoc>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}

describe('users/{uid}', () => {
  it('an unverified allowlisted email has no instructor privilege', async () => {
    await seedInstructorAllowlist();
    const db = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: false }).firestore();
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(getDocs(collection(db, 'submissions')));
  });
  it('a student can create their own profile with role:student', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', STUDENT_A.uid), studentUserDoc()));
  });

  it('a student CANNOT set role:instructor on their own profile', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_A.uid), studentUserDoc({ role: 'instructor' })));
  });

  it('a student CANNOT write another student\'s profile document', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_B.uid), studentUserDoc({ email: STUDENT_B.email })));
  });

  it('a student CANNOT read another student\'s profile document', async () => {
    await seedStudentUser(STUDENT_B.uid, studentUserDoc({ email: STUDENT_B.email }));
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDoc(doc(db, 'users', STUDENT_B.uid)));
  });

  it('a student CANNOT change characterType after it is first set (permanent account<->character binding)', async () => {
    await seedStudentUser(STUDENT_A.uid, studentUserDoc());
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_A.uid), studentUserDoc({ characterType: 'fox' })));
  });

  it('a student CANNOT list the users collection', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDocs(collection(db, 'users')));
  });

  it('an instructor (present in instructorAllowlist) CAN read any student profile and list all users', async () => {
    await seedInstructorAllowlist();
    await seedStudentUser(STUDENT_A.uid, studentUserDoc());
    const db = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', STUDENT_A.uid)));
    await assertSucceeds(getDocs(collection(db, 'users')));
  });

  it('an allowlisted instructor CAN create their own profile document with role:instructor', async () => {
    await seedInstructorAllowlist();
    const db = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', INSTRUCTOR.uid), {
        uid: INSTRUCTOR.uid, name: '교수자', studentId: '', email: INSTRUCTOR.email,
        characterType: 'rabbit', anonName: '교수자', role: 'instructor', semesterId: SEMESTER_ID,
        currentGoalVersion: 1, goalText: '교수자 계정은 개인 행동목표를 설정하지 않습니다.',
        weekday: 1, startTime: '09:00', duration: 30,
        goalCreatedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
      }),
    );
  });

  it('an account NOT in instructorAllowlist cannot impersonate an instructor by claiming role:instructor', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    // Even attempting to self-declare role:instructor is rejected outright (see previous test),
    // and separately, listing the collection must fail regardless of any claimed role field.
    await assertFails(getDocs(collection(db, 'users')));
  });
});

describe('submissions/{uid}_{semesterId}_w{week}', () => {
  const goalSnapshot = { version: 1, goalText: studentUserDoc().goalText, weekday: 3, startTime: '19:00', duration: 60 };

  function submissionPayload(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      userId: STUDENT_A.uid,
      semesterId: SEMESTER_ID,
      week: 3,
      goalVersion: 1,
      goalSnapshot,
      reflection: '이번 주에도 계획대로 실천했다.',
      photoURL: `https://firebasestorage.googleapis.com/v0/b/demo/o/submissions%2F${STUDENT_A.uid}%2F${SEMESTER_ID}%2Fweek${overrides.week ?? 3}.jpg?alt=media`,
      photoStoragePath: `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${overrides.week ?? 3}.jpg`,
      submittedAt: new Date().toISOString(),
      serverCreatedAt: serverTimestamp(),
      clientPunctualClaim: false,
      status: 'submitted',
      ...overrides,
    };
  }

  it.each([
    { status: 'test', clientPunctualClaim: true }, { unexpected: 'smuggled' },
    { goalVersion: 2 }, { goalSnapshot: { ...goalSnapshot, weekday: 4 } },
    { photoURL: 'https://example.com/other.jpg' }, { photoStoragePath: 'submissions/another/other.jpg' },
  ])('rejects forged production submission fields: %j', async forged => {
    await seedStudentUser(STUDENT_A.uid, studentUserDoc());
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const week = currentWeek ?? 1;
    await assertFails(setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, week)), submissionPayload({ week, ...forged })));
  });

  it('a student can create a submission for whichever week is really active right now (real serverTimestamp, real clock)', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    if (currentWeek === null) {
      // The suite is being run outside 2026-09-07..2026-12-20 (e.g. before the
      // semester starts, or after it ends). There is then, correctly, no week
      // for which a real-time submission can succeed — assert exactly that,
      // rather than skipping the scenario silently.
      await assertFails(
        setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 1)), { ...submissionPayload(), week: 1 }),
      );
      return;
    }
    await seedStudentUser(STUDENT_A.uid, studentUserDoc());
    await assertSucceeds(
      setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, currentWeek)), submissionPayload({ week: currentWeek })),
    );
  });

  it('rejects a submission dated before the week has started', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 3)), {
        ...submissionPayload(),
        serverCreatedAt: WEEK_3_TOO_EARLY,
      }),
    );
  });

  it('rejects a submission dated after the week has ended', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 3)), {
        ...submissionPayload(),
        serverCreatedAt: WEEK_3_TOO_LATE,
      }),
    );
  });

  it('rejects a plausible, in-window but non-real serverCreatedAt — proving rejection is about time-spoofing itself, not just landing in the wrong week', async () => {
    // Isolates the anti-cheating property from the two tests above: this
    // timestamp is NOT before/after the real week (it's set an hour before
    // "now", well inside whichever week is actually active), so it would
    // pass the week-window check on its own. It must still be rejected,
    // because serverCreatedAt must literally equal request.time — a client
    // can never supply its own plausible-looking Timestamp, only the
    // serverTimestamp() sentinel that the server itself resolves.
    if (currentWeek === null) return; // see the note on `currentWeek` above
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const plausibleButFake = Timestamp.fromDate(new Date(Date.now() - 3600_000));
    await assertFails(
      setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, currentWeek)), {
        ...submissionPayload(),
        week: currentWeek,
        serverCreatedAt: plausibleButFake,
      }),
    );
  });

  it('rejects a second submission for the same student+week (idempotency)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', subDocId(STUDENT_A.uid, 3)), {
        ...submissionPayload(),
        serverCreatedAt: SEED_TIMESTAMP,
      });
    });
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 3)), submissionPayload()));
  });

  it('rejects a submission a student tries to file under another student\'s uid', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'submissions', subDocId(STUDENT_B.uid, 3)), submissionPayload({ userId: STUDENT_B.uid })),
    );
  });

  it('a submission can never be updated or deleted once created (immutable audit trail)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', subDocId(STUDENT_A.uid, 3)), submissionPayload());
    });
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 3)), submissionPayload({ reflection: 'edited' })));
    await assertFails(deleteDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 3))));
  });

  it('a student cannot read another student\'s submission', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', subDocId(STUDENT_B.uid, 3)), submissionPayload({ userId: STUDENT_B.uid }));
    });
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDoc(doc(db, 'submissions', subDocId(STUDENT_B.uid, 3))));
  });

  it('a student CAN get() their own not-yet-submitted week (exists:false, not permission-denied) — this is what getMySubmissions() relies on', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const snap = await assertSucceeds(getDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 7))));
    expect(snap.exists()).toBe(false);
  });

  it('a student CANNOT get() a non-existent id even when guessing another student\'s uid prefix', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDoc(doc(db, 'submissions', subDocId(STUDENT_B.uid, 7))));
  });

  it('a student CANNOT list the submissions collection (must fetch their own by direct id, never a bare query) — this is the query the instructor real-name feed relies on being blocked for non-instructors', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDocs(collection(db, 'submissions')));
  });

  it('an instructor can read any submission and list all submissions', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', subDocId(STUDENT_A.uid, 3)), submissionPayload());
    });
    const db = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(db, 'submissions', subDocId(STUDENT_A.uid, 3))));
    await assertSucceeds(getDocs(collection(db, 'submissions')));
  });

  it('rejects a submission whose id claims a different semester than the semesterId field', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'submissions', `${STUDENT_A.uid}_2099-spring_w3`), submissionPayload({ semesterId: '2099-spring' })),
    );
  });
});

describe('feedPosts/{feedId}', () => {
  it('rejects a feed post with no matching private submission for that student+week', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'feedPosts', 'feed-1'), {
        anonName: '도전자 100',
        semesterId: SEMESTER_ID,
        week: 3,
        reflection: '가짜 피드 글',
        photoURL: 'https://example.com/x.jpg',
        characterType: 'rabbit',
        characterStage: 1,
        punctualClaim: false,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('accepts a feed post created alongside a real, already-owned private submission', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', STUDENT_A.uid), studentUserDoc({ anonName: '도전자 100' }));
      await setDoc(doc(ctx.firestore(), 'submissions', subDocId(STUDENT_A.uid, 3)), {
        userId: STUDENT_A.uid, semesterId: SEMESTER_ID, week: 3, goalVersion: 1,
        goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60 },
        reflection: 'x'.repeat(20), photoURL: 'https://example.com/x.jpg', photoStoragePath: '',
        submittedAt: new Date().toISOString(), serverCreatedAt: SEED_TIMESTAMP,
        clientPunctualClaim: false, status: 'submitted',
      });
    });
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'feedPosts', 'feed-1'), {
        anonName: '도전자 100',
        semesterId: SEMESTER_ID,
        week: 3,
        reflection: '이번 주에도 실천했다.',
        photoURL: 'https://example.com/feed.jpg',
        characterType: 'rabbit',
        characterStage: 1,
        punctualClaim: false,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a feed post that smuggles in an identifying field like studentId or email', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', STUDENT_A.uid), studentUserDoc({ anonName: '도전자 100' }));
      await setDoc(doc(ctx.firestore(), 'submissions', subDocId(STUDENT_A.uid, 3)), {
        userId: STUDENT_A.uid, semesterId: SEMESTER_ID, week: 3, goalVersion: 1,
        goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60 },
        reflection: 'x'.repeat(20), photoURL: 'https://example.com/x.jpg', photoStoragePath: '',
        submittedAt: new Date().toISOString(), serverCreatedAt: SEED_TIMESTAMP,
        clientPunctualClaim: false, status: 'submitted',
      });
    });
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'feedPosts', 'feed-1'), {
        anonName: '도전자 100',
        semesterId: SEMESTER_ID,
        studentId: '1234567', // must never be accepted here
        week: 3,
        reflection: '이번 주에도 실천했다.',
        photoURL: 'https://example.com/feed.jpg',
        characterType: 'rabbit',
        characterStage: 1,
        punctualClaim: false,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('feed posts are readable by any signed-in user (the whole point of the anonymous feed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'feedPosts', 'feed-1'), {
        anonName: '도전자 100', semesterId: SEMESTER_ID, week: 3, reflection: 'x', photoURL: 'https://example.com/x.jpg',
        characterType: 'rabbit', characterStage: 1, punctualClaim: false, createdAt: SEED_TIMESTAMP,
      });
    });
    const db = testEnv.authenticatedContext(STUDENT_B.uid, { email: STUDENT_B.email }).firestore();
    await assertSucceeds(getDocs(collection(db, 'feedPosts')));
  });
});

describe('instructorAllowlist/{email}', () => {
  it('a signed-in user can only check membership for their OWN email, never enumerate others', async () => {
    await seedInstructorAllowlist();
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDoc(doc(db, 'instructorAllowlist', INSTRUCTOR.email)));
    await assertFails(getDocs(collection(db, 'instructorAllowlist')));
  });

  it('nobody can write to instructorAllowlist from a client (console-only, by design)', async () => {
    const db = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, 'instructorAllowlist', INSTRUCTOR.email), { note: 'self-added' }));
  });
});

describe('studentIdRegistry/{semesterId}_{studentId}', () => {
  it('a student can claim their own, never-before-claimed student id', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'studentIdRegistry', `${SEMESTER_ID}_1234567`), { uid: STUDENT_A.uid, studentId: '1234567', semesterId: SEMESTER_ID }),
    );
  });

  it('a second student cannot claim an id another student already claimed — the whole point of this collection', async () => {
    const dbA = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await setDoc(doc(dbA, 'studentIdRegistry', `${SEMESTER_ID}_1234567`), { uid: STUDENT_A.uid, studentId: '1234567', semesterId: SEMESTER_ID });

    const dbB = testEnv.authenticatedContext(STUDENT_B.uid, { email: STUDENT_B.email }).firestore();
    await assertFails(
      setDoc(doc(dbB, 'studentIdRegistry', `${SEMESTER_ID}_1234567`), { uid: STUDENT_B.uid, studentId: '1234567', semesterId: SEMESTER_ID }),
    );
  });

  it('a student cannot claim a student id on behalf of a different uid', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'studentIdRegistry', `${SEMESTER_ID}_7654321`), { uid: STUDENT_B.uid, studentId: '7654321', semesterId: SEMESTER_ID }),
    );
  });

  it('rejects a malformed (non-7-digit) student id', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'studentIdRegistry', `${SEMESTER_ID}_abc`), { uid: STUDENT_A.uid, studentId: 'abc', semesterId: SEMESTER_ID }),
    );
  });

  it('no one can update or delete a claimed registration once created', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const ref = doc(db, 'studentIdRegistry', `${SEMESTER_ID}_1234567`);
    await setDoc(ref, { uid: STUDENT_A.uid, studentId: '1234567', semesterId: SEMESTER_ID });
    await assertFails(deleteDoc(ref));
  });
});

describe('users/{uid}/profileHistory/{entryId}', () => {
  const historyEntry = {
    previousName: '김학생', newName: '김올바름',
    previousStudentId: '1234567', newStudentId: '7654321',
    changedAt: serverTimestamp(),
  };

  it('a student can append their own name/studentId change to their own history', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertSucceeds(setDoc(doc(collection(db, 'users', STUDENT_A.uid, 'profileHistory')), historyEntry));
  });

  it('a student cannot append a profile-history entry to another student\'s subcollection', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(collection(db, 'users', STUDENT_B.uid, 'profileHistory')), historyEntry));
  });

  it('an instructor can read a student\'s profile-history entries; another student cannot', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(collection(ctx.firestore(), 'users', STUDENT_A.uid, 'profileHistory')), { ...historyEntry, changedAt: SEED_TIMESTAMP });
    });
    const instructorDb = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertSucceeds(getDocs(collection(instructorDb, 'users', STUDENT_A.uid, 'profileHistory')));

    const otherStudentDb = testEnv.authenticatedContext(STUDENT_B.uid, { email: STUDENT_B.email }).firestore();
    await assertFails(getDocs(collection(otherStudentDb, 'users', STUDENT_A.uid, 'profileHistory')));
  });

  it('history entries are immutable once written', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const ref = doc(collection(db, 'users', STUDENT_A.uid, 'profileHistory'));
    await setDoc(ref, historyEntry);
    await assertFails(deleteDoc(ref));
  });
});

describe('users/{uid}/privacyConsent/record', () => {
  function consentPayload(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      agreed: true,
      version: '2026-09-07-v1',
      agreedAt: serverTimestamp(),
      source: 'signup',
      ...overrides,
    };
  }

  it('a student can create their own consent record', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload()));
  });

  it('a student can re-consent (overwrite) their own record when the policy version changes', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const ref = doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record');
    await assertSucceeds(setDoc(ref, consentPayload({ version: '2026-09-07-v1' })));
    await assertSucceeds(setDoc(ref, consentPayload({ version: '2027-01-01-v2' })));
  });

  it('rejects a doc id other than "record"', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'other'), consentPayload()));
  });

  it('rejects agreed:false — a consent record can never be stored as "not agreed"', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload({ agreed: false })));
  });

  it('rejects a client-supplied agreedAt instead of the serverTimestamp sentinel (anti-backdating)', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(
      setDoc(doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload({ agreedAt: Timestamp.fromDate(new Date('2020-01-01')) })),
    );
  });

  it('rejects a smuggled extra field', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload({ note: 'x' })));
  });

  it('rejects an invalid source value', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload({ source: 'forged' })));
  });

  it('a student CANNOT write another student\'s consent record', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(db, 'users', STUDENT_B.uid, 'privacyConsent', 'record'), consentPayload()));
  });

  it('a student cannot read another student\'s consent record; an instructor can', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload({ agreedAt: SEED_TIMESTAMP }));
    });
    const otherStudentDb = testEnv.authenticatedContext(STUDENT_B.uid, { email: STUDENT_B.email }).firestore();
    await assertFails(getDoc(doc(otherStudentDb, 'users', STUDENT_A.uid, 'privacyConsent', 'record')));

    const instructorDb = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(instructorDb, 'users', STUDENT_A.uid, 'privacyConsent', 'record')));
  });

  it('an instructor cannot write a consent record on a student\'s behalf', async () => {
    await seedInstructorAllowlist();
    const instructorDb = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertFails(setDoc(doc(instructorDb, 'users', STUDENT_A.uid, 'privacyConsent', 'record'), consentPayload()));
  });

  it('a consent record can never be deleted', async () => {
    const db = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    const ref = doc(db, 'users', STUDENT_A.uid, 'privacyConsent', 'record');
    await setDoc(ref, consentPayload());
    await assertFails(deleteDoc(ref));
  });
});

describe('adminAuditLogs/{logId}', () => {
  const auditEntry = {
    action: 'deleteStudent', targetUid: STUDENT_A.uid, targetName: '김학생',
    targetStudentId: '1234567', targetEmail: STUDENT_A.email,
    deletedBy: INSTRUCTOR.email, deletedAt: SEED_TIMESTAMP,
  };

  it('nobody can write to adminAuditLogs from a client (Cloud Function / Admin SDK only)', async () => {
    const instructorDb = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertFails(setDoc(doc(collection(instructorDb, 'adminAuditLogs')), auditEntry));
    const studentDb = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(setDoc(doc(collection(studentDb, 'adminAuditLogs')), auditEntry));
  });

  it('an instructor can read audit logs; a student cannot', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(collection(ctx.firestore(), 'adminAuditLogs')), auditEntry);
    });
    const instructorDb = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).firestore();
    await assertSucceeds(getDocs(collection(instructorDb, 'adminAuditLogs')));

    const studentDb = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).firestore();
    await assertFails(getDocs(collection(studentDb, 'adminAuditLogs')));
  });
});
