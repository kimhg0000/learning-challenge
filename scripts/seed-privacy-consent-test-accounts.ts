#!/usr/bin/env -S npx tsx --env-file=.env.staging
// Prepares the two staging accounts used to manually verify the privacy
// consent feature end to end (see the feature's completion report for the
// exact click-through steps):
//
//   - privacy-existing-test@example.com — an EXISTING student account with
//     completed onboarding (real profile/goal data), created the same way
//     completeOnboarding() always has — so it has NO privacyConsent record,
//     exactly like every real student account that signed up before this
//     feature existed. Logging in with it must show the consent screen.
//
//   - privacy-new-test@example.com — deliberately NOT created here. Leaving
//     it absent lets the person testing this feature sign up with it fresh
//     in the browser and see the real first-time-signup consent flow,
//     rather than a script pre-creating the very account meant to prove out
//     "brand new signup" behavior.
//
// Idempotent: safe to re-run — if privacy-existing-test@example.com already
// exists this just signs in and confirms its state instead of erroring out.
//
//   npx tsx --env-file=.env.staging scripts/seed-privacy-consent-test-accounts.ts

import { FirebaseBackend } from '../src/backend/firebaseBackend';
import { SEMESTER_ID } from '../src/constants';
import type { GoalSettings } from '../src/types';

const EMAIL = 'privacy-existing-test@example.com';
const PASSWORD = 'SeedPass123!';
const STUDENT_ID = '2090099';
const NAME = '김동의';

async function main() {
  console.log(`Seeding privacy-consent existing-user test account (SEMESTER_ID=${SEMESTER_ID})`);
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
    const goal: GoalSettings = { goalText: '개인정보 동의 재테스트용 계정입니다. 매주 저녁 책상에서 30분 집중합니다.', weekday: 4, startTime: '20:00', duration: 30 };
    const profile = await backend.completeOnboarding(uid, EMAIL, {
      name: NAME, studentId: STUDENT_ID, characterType: 'panda', goal,
    });
    console.log(`Onboarding completed: name=${profile.name} studentId=${profile.studentId} characterType=${profile.characterType}`);
  }

  const consent = await backend.getPrivacyConsent(uid);
  if (consent) {
    console.log(`WARNING: this account already has a privacyConsent record (version=${consent.version}, source=${consent.source}) — it will NOT show the consent screen. Delete users/${uid}/privacyConsent/record in the Firebase Console if you need to re-test the "existing user, no consent" path.`);
  } else {
    console.log('Confirmed: no privacyConsent record exists yet — logging in with this account should show the consent screen.');
  }

  await backend.signOutUser();
  console.log(`\nDone. Credentials: ${EMAIL} / ${PASSWORD}`);
  console.log('For the brand-new-signup test, sign up fresh in the browser with privacy-new-test@example.com (intentionally not pre-created).');
  process.exit(0);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
