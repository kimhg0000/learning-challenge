import { describe, expect, it } from 'vitest';
import {
  getCurrentProgramWeek,
  getScheduledWindow,
  getWeekBounds,
  isWithinSubmissionWindow,
} from '../../src/utils/date';
import { PROGRAM_START, TOTAL_WEEKS } from '../../src/constants';

describe('getWeekBounds', () => {
  it('week 1 starts exactly at PROGRAM_START (Monday 00:00 KST)', () => {
    const { start } = getWeekBounds(1);
    expect(start.getTime()).toBe(PROGRAM_START.getTime());
  });

  it('every week spans exactly Monday 00:00:00.000 to Sunday 23:59:59.999', () => {
    for (let w = 1; w <= TOTAL_WEEKS; w++) {
      const { start, end } = getWeekBounds(w);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getTime() - start.getTime()).toBe(7 * 86400000 - 1);
    }
  });

  it('consecutive weeks are back-to-back with no gap or overlap', () => {
    const w1 = getWeekBounds(3);
    const w2 = getWeekBounds(4);
    expect(w2.start.getTime() - w1.end.getTime()).toBe(1);
  });
});

describe('isWithinSubmissionWindow', () => {
  it('accepts a submission any day within the week (not just the goal weekday)', () => {
    const { start } = getWeekBounds(2);
    const monday = new Date(start);
    const thursday = new Date(start.getTime() + 3 * 86400000 + 3600000); // Thu, mid-day
    const sunday = new Date(start.getTime() + 6 * 86400000 + 23 * 3600000);
    expect(isWithinSubmissionWindow(2, monday)).toBe(true);
    expect(isWithinSubmissionWindow(2, thursday)).toBe(true);
    expect(isWithinSubmissionWindow(2, sunday)).toBe(true);
  });

  it('rejects a submission before the week starts (future week)', () => {
    const { start } = getWeekBounds(5);
    const before = new Date(start.getTime() - 1000);
    expect(isWithinSubmissionWindow(5, before)).toBe(false);
  });

  it('rejects a submission after the week ends (late submission)', () => {
    const { end } = getWeekBounds(5);
    const after = new Date(end.getTime() + 1000);
    expect(isWithinSubmissionWindow(5, after)).toBe(false);
  });
});

describe('getScheduledWindow (punctual badge window)', () => {
  it('computes the exact start..end interval from the goal snapshot', () => {
    // Week 1 Monday is 2026-09-07. weekday=3 (Wed) -> 2026-09-09.
    const win = getScheduledWindow(1, 3, '12:00', 60);
    expect(win.start.getFullYear()).toBe(2026);
    expect(win.start.getMonth()).toBe(8); // 0-indexed September
    expect(win.start.getDate()).toBe(9);
    expect(win.start.getHours()).toBe(12);
    expect(win.end.getTime() - win.start.getTime()).toBe(60 * 60000);
  });
});

describe('getCurrentProgramWeek', () => {
  it('clamps to week 1 before the program starts', () => {
    expect(getCurrentProgramWeek(new Date('2026-08-01T00:00:00+09:00'))).toBe(1);
  });

  it('clamps to the last week after the program ends', () => {
    expect(getCurrentProgramWeek(new Date('2027-01-01T00:00:00+09:00'))).toBe(TOTAL_WEEKS);
  });

  it('reports week 3 mid-way through week 3', () => {
    const { start } = getWeekBounds(3);
    const midWeek = new Date(start.getTime() + 2 * 86400000);
    expect(getCurrentProgramWeek(midWeek)).toBe(3);
  });
});
