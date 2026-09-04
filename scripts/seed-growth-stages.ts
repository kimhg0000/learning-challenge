#!/usr/bin/env -S npx tsx --env-file=.env.staging
// Seeds 5 staging-only accounts — rabbit-stage1@example.com .. stage5 — all
// with animalType='rabbit', so the SAME animal can be compared side by side
// across all 5 growth stages (the previous version of this script used a
// different animal per stage, which made that comparison impossible — see
// the 2026-09 bug report). Each account reaches its target stage through
// the REAL submission flow (real submitWeek() calls, real photos, real
// reflections) rather than a hand-set level field, so this is also a live
// correctness check of completedCount -> XP -> stage.
//
// Like scripts/seed-staging-data.ts, submitting weeks whose real calendar
// window has already passed (or hasn't started) requires the staging-only
// rules relaxation:
//   npm run staging:generate-seed-rules
//   npm run staging:deploy-seed-rules
//   npx tsx --env-file=.env.staging scripts/seed-growth-stages.ts
//   npm run staging:deploy-rules   <-- ALWAYS restore the real rules after
//
// Student ids 9100001-9100005 (a fresh range — the previous batch's
// 9000001-9000005 stay permanently claimed in studentIdRegistry even after
// those accounts were deleted, by design, see firestore.rules).

import { FirebaseBackend } from '../src/backend/firebaseBackend';
import { GROWTH_STAGES } from '../src/constants';
import { getGrowthState } from '../src/utils/growth';
import { getWeekBounds } from '../src/utils/date';
import { tinyPngBlob } from '../tests/fixtures/tinyPng';
import type { GoalSettings } from '../src/types';

function isoInsideWeek(week: number): string {
  const { start } = getWeekBounds(week);
  const inside = new Date(start.getTime() + 12 * 3600000); // Monday noon of that week
  return inside.toISOString();
}

async function main() {
  const backend = new FirebaseBackend();

  for (let stageIndex = 0; stageIndex < GROWTH_STAGES.length; stageIndex++) {
    const stageDef = GROWTH_STAGES[stageIndex];
    const completions = stageDef.stage === 5 ? 15 : stageDef.minCompleted;
    const email = `rabbit-stage${stageDef.stage}@example.com`;
    const studentId = `910000${stageDef.stage}`;

    if (stageIndex > 0) await backend.signOutUser();
    await backend.signUpEmail(email, 'SeedPass123!');
    const uid: string = await new Promise((resolve) => {
      const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
    });
    const goal: GoalSettings = {
      goalText: `[Rabbit Stage ${stageDef.stage}] 매주 같은 행동을 반복해 캐릭터를 키운다.`,
      weekday: 3,
      startTime: '19:00',
      duration: 60,
    };
    await backend.completeOnboarding(uid, email, {
      name: `Rabbit Stage ${stageDef.stage}`,
      studentId,
      characterType: 'rabbit',
      goal,
    });
    console.log(`\n=== Rabbit Stage ${stageDef.stage} account created: ${email} (${uid}), target completions=${completions} ===`);

    for (let week = 1; week <= completions; week++) {
      globalThis.__QUEST_TEST_NOW = isoInsideWeek(week);
      const profile = (await backend.getProfile(uid))!;
      await backend.submitWeek(uid, profile, {
        week,
        photoBlob: tinyPngBlob(),
        reflection: `[Rabbit Stage ${stageDef.stage}] ${week}주차 제출입니다. 동일 캐릭터 성장 비교용 더미 성찰입니다.`,
      });
    }
    globalThis.__QUEST_TEST_NOW = undefined;

    const subs = await backend.getMySubmissions(uid);
    const growth = getGrowthState(subs.length);
    console.log(`  completions=${subs.length} -> XP=${growth.xp} -> stage=${growth.stage} (${growth.name}) ${growth.stage === stageDef.stage ? 'OK matches target' : '*** MISMATCH ***'}`);
    console.log(`  login: ${email} / SeedPass123! (studentId ${studentId}, character rabbit)`);
  }

  console.log('\nDone. Sign in as rabbit-stage1..5@example.com (password SeedPass123!) to compare the same animal across all 5 growth stages.');
  process.exit(0);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
