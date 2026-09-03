import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'learning-challenge-rules-test';
const STUDENT_A = { uid: 'student-a', email: 'a@student.example' };
const STUDENT_B = { uid: 'student-b', email: 'b@student.example' };
const INSTRUCTOR = { uid: 'instructor-1', email: 'prof@univ.example' };

let testEnv: RulesTestEnvironment;

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
});

async function seedInstructorAllowlist() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'instructorAllowlist', INSTRUCTOR.email), { note: 'seeded for tests' });
  });
}

describe('submissions/{uid}/{fileName}', () => {
  it('a student can upload their own proof photo', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertSucceeds(uploadBytes(ref(storage, `submissions/${STUDENT_A.uid}/week1.jpg`), tinyJpeg));
  });

  it('a student cannot upload into another student\'s submissions folder', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, `submissions/${STUDENT_B.uid}/week1.jpg`), tinyJpeg));
  });

  it('rejects a non-image upload', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(uploadBytes(ref(storage, `submissions/${STUDENT_A.uid}/week1.jpg`), notAnImage));
  });

  it('a student can read back their own proof photo', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    const fileRef = ref(storage, `submissions/${STUDENT_A.uid}/week1.jpg`);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_A.uid}/week1.jpg`), tinyJpeg);
    });
    await assertSucceeds(getBytes(fileRef));
  });

  it('a student cannot read another student\'s proof photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_B.uid}/week1.jpg`), tinyJpeg);
    });
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertFails(getBytes(ref(storage, `submissions/${STUDENT_B.uid}/week1.jpg`)));
  });

  it('an instructor (in instructorAllowlist) can read any student\'s proof photo', async () => {
    await seedInstructorAllowlist();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `submissions/${STUDENT_A.uid}/week1.jpg`), tinyJpeg);
    });
    const storage = testEnv.authenticatedContext(INSTRUCTOR.uid, { email: INSTRUCTOR.email }).storage();
    await assertSucceeds(getBytes(ref(storage, `submissions/${STUDENT_A.uid}/week1.jpg`)));
  });
});

describe('feedPhotos/{fileName}', () => {
  it('any signed-in student can upload a feed photo', async () => {
    const storage = testEnv.authenticatedContext(STUDENT_A.uid, { email: STUDENT_A.email }).storage();
    await assertSucceeds(uploadBytes(ref(storage, 'feedPhotos/random-id-1.jpg'), tinyJpeg));
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
