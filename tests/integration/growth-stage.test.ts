import { beforeAll, describe, expect, it } from 'vitest';
import { getGrowthState } from '../../src/utils/growth';
import { punctualBadgeCount } from '../../src/utils/punctual';
import { getWeekBounds } from '../../src/utils/date';
import { setupIntegrationRules, createStudent, tinyJpegBlob } from './helpers';

beforeAll(async () => {
  await setupIntegrationRules();
});

function mondayNoonOf(week: number): string {
  const { start } = getWeekBounds(week);
  return new Date(start.getTime() + 12 * 3600000).toISOString();
}

describe('growth stage 5 never requires a single punctual badge', () => {
  it('15 real, on-window-but-off-schedule submissions (goal is Wed 19:00, all submitted Monday noon) reach Stage 5 with zero punctual badges', async () => {
    // The default test goal (see helpers.ts DEFAULT_GOAL) is weekday=3 (Wed)
    // 19:00-20:00. Submitting every week at Monday noon instead lands each
    // submission inside that week's Mon-Sun window (so submitWeek() and the
    // relaxed rules both accept it) but always OUTSIDE the goal's specific
    // scheduled window, so isPunctualSubmission() must be false for every one
    // of them — this is what proves stage progression is completion-count-
    // only and never secretly gated on punctuality.
    const { backend, uid, profile } = await createStudent('growth-no-punctual@student.example');

    for (let week = 1; week <= 15; week++) {
      globalThis.__QUEST_TEST_NOW = mondayNoonOf(week);
      await backend.submitWeek(uid, profile, {
        week,
        photoBlob: tinyJpegBlob(),
        reflection: `${week}주차 제출 (정시 배지 없이 15회 완료 검증용).`,
      });
    }
    globalThis.__QUEST_TEST_NOW = undefined;

    const subs = await backend.getMySubmissions(uid);
    expect(subs).toHaveLength(15);
    expect(punctualBadgeCount(subs)).toBe(0);

    const growth = getGrowthState(subs.length);
    expect(growth.stage).toBe(5);
  });
});
