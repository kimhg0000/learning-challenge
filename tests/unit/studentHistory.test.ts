import { describe, expect, it } from 'vitest';
import { computeStudentWeekRows } from '../../src/utils/studentHistory';
import { getWeekBounds } from '../../src/utils/date';
import { TOTAL_WEEKS } from '../../src/constants';
import type { Submission } from '../../src/types';

function fakeSubmission(week: number): Submission {
  return {
    id: `u_sem_w${week}`,
    userId: 'u',
    semesterId: 'sem',
    week,
    goalVersion: 1,
    goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '12:00', duration: 60 },
    reflection: `week ${week} reflection`,
    photoURL: `https://example.com/${week}.jpg`,
    photoStoragePath: `submissions/u/sem/week${week}.jpg`,
    submittedAt: new Date().toISOString(),
    serverCreatedAt: new Date(),
    clientPunctualClaim: false,
    status: 'submitted',
  };
}

describe('computeStudentWeekRows', () => {
  it('returns exactly TOTAL_WEEKS rows, one per week, in order', () => {
    const rows = computeStudentWeekRows([]);
    expect(rows).toHaveLength(TOTAL_WEEKS);
    expect(rows.map((r) => r.week)).toEqual(Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1));
  });

  it("marks a week with a matching submission as 'submitted' and attaches it", () => {
    const sub = fakeSubmission(3);
    const rows = computeStudentWeekRows([sub], new Date(getWeekBounds(3).start.getTime() + 3600000));
    const row3 = rows.find((r) => r.week === 3)!;
    expect(row3.status).toBe('submitted');
    expect(row3.sub).toBe(sub);
  });

  it("marks a past week with no submission as 'missing', never 'future'", () => {
    // referenceNow is inside week 5's window, so week 1-4 (no submission) are already past.
    const referenceNow = new Date(getWeekBounds(5).start.getTime() + 3600000);
    const rows = computeStudentWeekRows([], referenceNow);
    for (const w of [1, 2, 3, 4]) {
      expect(rows.find((r) => r.week === w)!.status).toBe('missing');
    }
  });

  it("marks a week that has not started yet as 'future', regardless of submission count so far", () => {
    const referenceNow = new Date(getWeekBounds(2).start.getTime() + 3600000); // inside week 2
    const rows = computeStudentWeekRows([], referenceNow);
    for (const w of [3, 4, 5]) {
      expect(rows.find((r) => r.week === w)!.status).toBe('future');
    }
  });

  it('a student who submitted weeks 1 and 3 (skipping 2) shows exactly that pattern, not off-by-one', () => {
    const referenceNow = new Date(getWeekBounds(4).start.getTime() + 3600000);
    const rows = computeStudentWeekRows([fakeSubmission(1), fakeSubmission(3)], referenceNow);
    expect(rows.find((r) => r.week === 1)!.status).toBe('submitted');
    expect(rows.find((r) => r.week === 2)!.status).toBe('missing');
    expect(rows.find((r) => r.week === 3)!.status).toBe('submitted');
    expect(rows.find((r) => r.week === 4)!.status).toBe('missing');
    expect(rows.find((r) => r.week === 5)!.status).toBe('future');
  });
});
