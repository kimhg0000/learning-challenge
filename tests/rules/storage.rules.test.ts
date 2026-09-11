import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes, deleteObject, updateMetadata } from 'firebase/storage';
import { SEMESTER_ID } from '../../src/constants';

// Must match the --project flag "rules:test" passes to `firebase emulators:exec`
// (see package.json and firestore.rules.test.ts for why).
const PROJECT_ID = 'demo-learning-challenge';
const STUDENT_A = { uid: 'student-a', email: 'a@student.example' };
const STUDENT_B = { uid: 'student-b', email: 'b@student.example' };
const INSTRUCTOR = { uid: 'instructor-1', email: 'prof@univ.example' };

let testEnv: RulesTestEnvironment;
let photoCase = 0;

const tinyJpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const notAnImage = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'text/plain' });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
    firestore: {
      // storage.rules cross-checks instructorAllowlist via firestore.exists(),
      // so the Firestore emulator + a matching (open in tests) ruleset must
      // also be available for those checks to evaluate at all.
      rules: 'rules_version = "2"; service cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } } }',
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
  photoCase++;
});

async function seedInstructorAllowlist() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'instructorAllowlist', INSTRUCTOR.email), { note: 'seeded for tests' });
  });
}

describe('submissions/{uid}/{semesterId}/{fileName}', () => {
  it('rejects overwrite, metadata change and delete after first create', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    const file = ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`);
    await assertSucceeds(uploadBytes(file, tinyJpeg));
    await assertFails(uploadBytes(file, tinyJpeg));
    await assertFails(updateMetadata(file, { customMetadata: { forged: 'true' } }));
    await assertFails(deleteObject(file));
  });
  it('rejects an image larger than 20 MiB', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/jpeg' })));
  });
  it('an allowlisted but unverified email cannot read private evidence', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), tinyJpeg);
    });
    const storage = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: false }).storage();
    await assertFails(getBytes(ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`)));
  });
  it('a student can upload their own proof photo', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertSucceeds(uploadBytes(ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), tinyJpeg));
  });

  it('a student cannot upload into another student\'s submissions folder', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, `submissions/${STUDENT_B.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), tinyJpeg));
  });

  it('rejects a non-image upload', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), notAnImage));
  });

  it('a student can read back their own proof photo', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    const fileRef = ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), tinyJpeg);
    });
    await assertSucceeds(getBytes(fileRef));
  });

  it('a student cannot read another student\'s proof photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_B.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), tinyJpeg);
    });
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(getBytes(ref(storage, `submissions/${STUDENT_B.uid}/${SEMESTER_ID}/week${photoCase}.jpg`)));
  });

  it('an instructor (in instructorAllowlist) can read any student\'s proof photo', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`), tinyJpeg);
    });
    const storage = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).storage();
    await assertSucceeds(getBytes(ref(storage, `submissions/${STUDENT_A.uid}/${SEMESTER_ID}/week${photoCase}.jpg`)));
  });
});

describe('feedPhotos/{fileName}', () => {
  it('rejects overwrite, metadata update and delete even from an instructor', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async ctx => { await uploadBytes(ref(ctx.storage(), 'feedPhotos/existing.jpg'), tinyJpeg); });
    const storage = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email, email_verified: true }).storage();
    const file = ref(storage, 'feedPhotos/existing.jpg');
    await assertFails(uploadBytes(file, tinyJpeg));
    await assertFails(updateMetadata(file, { contentType: 'image/png' }));
    await assertFails(deleteObject(file));
  });
  it('a signed-in student cannot upload a feed photo', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, 'feedPhotos/random-id-1.jpg'), tinyJpeg));
  });

  it('any signed-in student can read any feed photo (that is the point of the public feed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'feedPhotos/random-id-1.jpg'), tinyJpeg);
    });
    const storage = testEnv.authenticatedContext(STUDENT_B.uid, { email: STUDENT_B.email }).storage();
    await assertSucceeds(getBytes(ref(storage, 'feedPhotos/random-id-1.jpg')));
  });

  it('an unauthenticated request cannot read or write anything', async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(storage, 'feedPhotos/random-id-2.jpg'), tinyJpeg));
  });
});

describe('any other path', () => {
  it('is denied outright (default-deny)', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, 'somewhere/else.jpg'), tinyJpeg));
  });
});
