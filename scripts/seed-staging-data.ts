#!/usr/bin/env -S npx tsx --env-file=.env.staging
// Seeds the staging Firebase project with exactly two realistic student
// records, through the REAL FirebaseBackend (not raw Firestore writes), so
// the seed data exercises — and thereby proves out — the exact same
// submitWeek()/updateGoal()/completeOnboarding() code real students use.
//
// PREREQUISITE: firestore.staging.seed.rules must already be deployed (its
// only difference from the real firestore.staging.rules is that the
// week-window check is relaxed), because this script deliberately creates a
// "week 1" submission for Student A after week 1's real calendar window has
// already passed — see scripts/generate-staging-seed-rules.mjs for why that
// requires a temporary rules relaxation instead of a client-side trick.
//
//   npm run staging:generate-seed-rules
//   npm run staging:deploy-seed-rules
//   npm run staging:seed
//   npm run staging:deploy-rules   <-- ALWAYS restore the real rules after

import { FirebaseBackend } from '../src/backend/firebaseBackend';
import { PROGRAM_START, SEMESTER_ID } from '../src/constants';
import { tinyPngBlob } from '../tests/fixtures/tinyPng';
import type { GoalSettings } from '../src/types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "HH:MM" for right now in the local (KST) clock, rounded down to the nearest 30 minutes. */
function currentHalfHour(): string {
  const d = new Date();
  const mins = d.getMinutes() < 30 ? 0 : 30;
  return `${pad(d.getHours())}:${pad(mins)}`;
}

async function main() {
  console.log(`Seeding staging project (SEMESTER_ID=${SEMESTER_ID}, PROGRAM_START=${PROGRAM_START.toISOString()})`);
  const todayWeekday = new Date().getDay(); // 0=Sun..6=Sat, matches GoalSettings.weekday
  const nowSlot = currentHalfHour();

  // A single shared FirebaseBackend instance, reused sequentially for both
  // students (signing out between them) — mirrors how the real app only
  // ever has one signed-in user per client at a time, and avoids
  // initializeFirestore() being called twice with conflicting options, which
  // real (non-emulator) mode does not support across multiple instances in
  // one process.
  const backend = new FirebaseBackend();

  // --- Student A: week 1 + week 3, goal v1 -> v2, ends up with a punctual badge ---
  const emailA = `staging-seed-a-${Date.now()}@example.com`;
  await backend.signUpEmail(emailA, 'SeedPass123!');
  const uidA: string = await new Promise((resolve) => {
    const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
  });
  const goalV1: GoalSettings = { goalText: '매일 저녁 도서관에서 전공 서적을 60분 읽고 핵심 내용을 정리한다.', weekday: 3, startTime: '19:00', duration: 60 };
  await backend.completeOnboarding(uidA, emailA, {
    name: '김도전', studentId: '2071001', characterType: 'rabbit', goal: goalV1,
  });
  console.log(`Student A created: ${emailA} (${uidA})`);

  // The CLIENT-side submission-window pre-check (isWithinSubmissionWindow)
  // uses the real wall clock and would reject week 1 outright since its
  // window (Aug 17-23) has already passed — the seed-only rules relaxation
  // only covers the SERVER-side check. Point the client check at an instant
  // inside week 1's window instead (see utils/date.ts now()); this does NOT
  // affect the actual stored timestamps (submittedAt/serverCreatedAt still
  // reflect the real time the write happens), only the pre-check gate.
  globalThis.__QUEST_TEST_NOW = '2026-08-19T12:00:00+09:00'; // inside week 1's window
  await backend.submitWeek(uidA, (await backend.getProfile(uidA))!, {
    week: 1,
    photoBlob: tinyPngBlob(),
    reflection: '1주차 첫 도전이었습니다. 도서관 자리를 못 구해서 계획보다 늦게 시작했지만 목표한 60분을 채웠습니다. 다음 주에는 더 일찍 움직이겠습니다.',
  });
  globalThis.__QUEST_TEST_NOW = undefined;
  console.log('Student A week 1 submitted (historical — necessarily non-punctual, real time cannot be inside week 1\'s past window).');

  const goalV2: GoalSettings = { goalText: '매주 목요일 낮에 스터디룸에서 전공 서적을 2시간 읽고 배운 점을 3줄로 정리한다.', weekday: todayWeekday, startTime: nowSlot, duration: 120 };
  await backend.updateGoal(uidA, goalV2);
  console.log(`Student A goal updated to v2 (weekday=${todayWeekday}, startTime=${nowSlot}, duration=120).`);

  await backend.submitWeek(uidA, (await backend.getProfile(uidA))!, {
    week: 3,
    photoBlob: tinyPngBlob(),
    reflection: '목표를 저녁에서 낮 시간대로 바꾼 뒤 첫 제출입니다. 스터디룸이 조용해서 집중이 잘 됐고, 계획한 시간에 맞춰 실천했습니다.',
  });
  console.log('Student A week 3 submitted (should be punctual — submitted right inside the just-updated v2 schedule window).');

  // --- Student B: week 3 only, deliberately NOT punctual (goal scheduled for a different weekday) ---
  await backend.signOutUser();
  const emailB = `staging-seed-b-${Date.now()}@example.com`;
  await backend.signUpEmail(emailB, 'SeedPass123!');
  const uidB: string = await new Promise((resolve) => {
    const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
  });
  const nonPunctualWeekday = (todayWeekday + 3) % 7; // any day other than today
  const goalB: GoalSettings = { goalText: '매주 아침 운동장에서 30분 조깅하고 컨디션을 기록한다.', weekday: nonPunctualWeekday, startTime: '07:00', duration: 30 };
  await backend.completeOnboarding(uidB, emailB, {
    name: '박노력', studentId: '2071002', characterType: 'fox', goal: goalB,
  });
  console.log(`Student B created: ${emailB} (${uidB})`);

  await backend.submitWeek(uidB, (await backend.getProfile(uidB))!, {
    week: 3,
    photoBlob: tinyPngBlob(),
    reflection: '이번 주는 늦잠을 자서 계획한 아침 시간에 실천하지 못했습니다. 대신 오후에 조깅을 마쳤고 다음 주에는 아침 계획을 지키겠습니다.',
  });
  console.log('Student B week 3 submitted (deliberately non-punctual — goal scheduled for a different weekday than today).');

  // --- Cross-check: N submissions this week => N feed posts this week ---
  const feedWeek3 = await backend.listFeed(3);
  console.log(`\nfeedPosts for week 3 (semesterId=${SEMESTER_ID}): ${feedWeek3.length} (expect >= 2, one per student who submitted week 3)`);
  const feedWeek1 = await backend.listFeed(1);
  console.log(`feedPosts for week 1: ${feedWeek1.length} (expect >= 1)`);

  console.log('\nDone. Credentials for manual verification:');
  console.log(`  Student A: ${emailA} / SeedPass123!`);
  console.log(`  Student B: ${emailB} / SeedPass123!`);
  process.exit(0);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
