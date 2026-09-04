#!/usr/bin/env -S npx tsx --env-file=.env.staging
// Seeds 5 staging-only accounts, one per character-growth stage (1-5), each
// reaching that stage through the REAL submission flow — real submitWeek()
// calls, real photo uploads, real XP/completion-count math — rather than
// hand-setting a "level" field, so this actually proves the growth system's
// own rules (completion count -> XP -> stage) produce the right stage,
// exactly as the real app will for a real student over 15 real weeks.
//
// Like scripts/seed-staging-data.ts, submitting weeks whose real calendar
// window has already passed (or hasn't started) requires the staging-only
// rules relaxation:
//   npm run staging:generate-seed-rules
//   npm run staging:deploy-seed-rules
//   npx tsx --env-file=.env.staging scripts/seed-growth-stages.ts
//   npm run staging:deploy-rules   <-- ALWAYS restore the real rules after
//
// These accounts are clearly named/numbered ([성장테스트] Stage N, student
// ids 9000001-9000005) so they're immediately distinguishable from real
// staging test data in the instructor dashboard/feed, and are filterable
// there by searching "성장테스트" or "900000".

import { FirebaseBackend } from '../src/backend/firebaseBackend';
import { GROWTH_STAGES } from '../src/constants';
import { getGrowthState } from '../src/utils/growth';
import { getWeekBounds } from '../src/utils/date';
import { tinyPngBlob } from '../tests/fixtures/tinyPng';
import type { CharacterType, GoalSettings } from '../src/types';

const CHARACTERS: CharacterType[] = ['rabbit', 'fox', 'otter', 'panda', 'rabbit'];

function isoInsideWeek(week: number): string {
  const { start } = getWeekBounds(week);
  const inside = new Date(start.getTime() + 12 * 3600000); // Monday noon of that week
  return inside.toISOString();
}

async function main() {
  const backend = new FirebaseBackend();

  for (let stageIndex = 0; stageIndex < GROWTH_STAGES.length; stageIndex++) {
    const stageDef = GROWTH_STAGES[stageIndex];
    // The stage AFTER this one needs at least stageDef+1's threshold to NOT
    // be reached, so for stage 1-4 submit exactly at this stage's own
    // threshold (never crossing into the next); the final stage submits all
    // 15 weeks for a clean "100% + 최종 성장형" demo.
    const completions = stageIndex === GROWTH_STAGES.length - 1 ? 15 : stageDef.minCompleted;
    const email = `staging-growth-stage-${stageDef.stage}@example.com`;
    const character = CHARACTERS[stageIndex];
    const studentId = `900000${stageDef.stage}`;

    if (stageIndex > 0) await backend.signOutUser();
    await backend.signUpEmail(email, 'SeedPass123!');
    const uid: string = await new Promise((resolve) => {
      const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
    });
    const goal: GoalSettings = {
      goalText: `[성장테스트] Stage ${stageDef.stage} 계정 — 매주 같은 행동을 반복해 캐릭터를 키운다.`,
      weekday: 3,
      startTime: '19:00',
      duration: 60,
    };
    await backend.completeOnboarding(uid, email, {
      name: `[성장테스트] Stage ${stageDef.stage}`,
      studentId,
      characterType: character,
      goal,
    });
    console.log(`\n=== Stage ${stageDef.stage} account created: ${email} (${uid}), character=${character}, target completions=${completions} ===`);

    for (let week = 1; week <= completions; week++) {
      globalThis.__QUEST_TEST_NOW = isoInsideWeek(week);
      const profile = (await backend.getProfile(uid))!;
      await backend.submitWeek(uid, profile, {
        week,
        photoBlob: tinyPngBlob(),
        reflection: `[성장테스트] Stage ${stageDef.stage} 계정의 ${week}주차 제출입니다. 캐릭터 성장 확인용 더미 성찰입니다.`,
      });
    }
    globalThis.__QUEST_TEST_NOW = undefined;

    const finalProfile = (await backend.getProfile(uid))!;
    const subs = await backend.getMySubmissions(uid);
    const growth = getGrowthState(subs.length);
    console.log(`  completions=${subs.length} -> XP=${growth.xp} -> stage=${growth.stage} (${growth.name}) ${growth.stage === stageDef.stage ? 'OK matches target' : '*** MISMATCH ***'}`);
    console.log(`  login: ${email} / SeedPass123! (studentId ${studentId}, character ${character})`);
  }

  console.log('\nDone. Sign in as any of the above accounts, or search "성장테스트" / "900000" in the instructor dashboard/feed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
