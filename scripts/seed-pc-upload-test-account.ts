#!/usr/bin/env -S npx tsx --env-file=.env.staging
// Creates (or verifies) a single fixed-credential staging student account for
// manual PC photo-upload QA (file picker -> preview -> reflection -> submit).
// Idempotent: safe to re-run — if the account already exists this just signs
// in and confirms onboarding is complete instead of erroring out.
//
//   npx tsx --env-file=.env.staging scripts/seed-pc-upload-test-account.ts

import { FirebaseBackend } from '../src/backend/firebaseBackend';
import { SEMESTER_ID } from '../src/constants';
import type { GoalSettings } from '../src/types';

const EMAIL = 'pc-upload-test@example.com';
const PASSWORD = 'SeedPass123!';
const STUDENT_ID = '2090001';
const NAME = '김피시';

async function main() {
  console.log(`Seeding PC-upload test account (SEMESTER_ID=${SEMESTER_ID})`);
  const backend = new FirebaseBackend();

  let uid: string;
  try {
    await backend.signUpEmail(EMAIL, PASSWORD);
    uid = await new Promise<string>((resolve) => {
      const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
    });
    console.log(`Account created: ${EMAIL} (${uid})`);
  } catch (err) {
    console.log(`signUpEmail failed (likely already exists): ${(err as Error).message}. Signing in instead.`);
    await backend.signInEmail(EMAIL, PASSWORD);
    uid = await new Promise<string>((resolve) => {
      const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
    });
    console.log(`Signed in to existing account: ${EMAIL} (${uid})`);
  }

  const existing = await backend.getProfile(uid);
  if (existing && existing.role === 'student' && existing.studentId) {
    console.log('Onboarding already complete — leaving profile untouched.');
    console.log(`  name=${existing.name} studentId=${existing.studentId} characterType=${existing.characterType}`);
  } else {
    const goal: GoalSettings = { goalText: 'PC 업로드 테스트용 계정입니다. 매일 저녁 책상에서 30분 집중합니다.', weekday: 3, startTime: '19:00', duration: 30 };
    const profile = await backend.completeOnboarding(uid, EMAIL, {
      name: NAME, studentId: STUDENT_ID, characterType: 'otter', goal,
    });
    console.log(`Onboarding completed: name=${profile.name} studentId=${profile.studentId} characterType=${profile.characterType}`);
  }

  await backend.signOutUser();
  console.log('\nDone. No week has been submitted for this account — the current submittable week is left open for manual testing.');
  console.log(`Credentials: ${EMAIL} / ${PASSWORD}`);
  console.log(`Student ID: ${STUDENT_ID}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
