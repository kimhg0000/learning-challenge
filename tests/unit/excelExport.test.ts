import { describe, expect, it } from 'vitest';
import { buildExcelRows } from '../../src/admin/excelExport';
import { getScheduledWindow } from '../../src/utils/date';
import type { Submission, UserProfile } from '../../src/types';

function student(uid: string, name: string, studentId: string): UserProfile {
  return {
    uid, name, studentId, email: '', characterType: 'rabbit', anonName: 'x', role: 'student',
    currentGoalVersion: 1, goalText: 'goal', weekday: 3, startTime: '12:00', duration: 60,
    goalCreatedAt: '', updatedAt: '', createdAt: '',
  };
}

function submission(uid: string, week: number, punctual: boolean): Submission {
  const win = getScheduledWindow(week, 3, '12:00', 60);
  const when = punctual ? new Date(win.start.getTime() + 60000) : new Date(win.end.getTime() + 3600000);
  return {
    id: `${uid}_w${week}`, userId: uid, week, goalVersion: 1,
    goalSnapshot: { version: 1, goalText: 'goal', weekday: 3, startTime: '12:00', duration: 60 },
    reflection: 'x'.repeat(20), photoURL: 'https://example.com/x.jpg', photoStoragePath: '',
    submittedAt: when.toISOString(), serverCreatedAt: when, clientPunctualClaim: punctual, status: 'submitted',
  };
}

describe('buildExcelRows', () => {
  it('marks submitted weeks as 1 and missing weeks as 0, and totals correctly', () => {
    const students = [student('u1', '김한결', '1234567')];
    const submissions = [submission('u1', 1, true), submission('u1', 3, false)];
    const rows = buildExcelRows(students, submissions);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row['1주차']).toBe(1);
    expect(row['2주차']).toBe(0);
    expect(row['3주차']).toBe(1);
    expect(row['4주차']).toBe(0);
    expect(row['총 제출 수']).toBe(2);
    expect(row['정시 제출 수']).toBe(1);
  });

  it('never double-counts a duplicate submission document for the same student/week', () => {
    const students = [student('u1', '김한결', '1234567')];
    const dup1 = submission('u1', 5, true);
    const dup2 = { ...submission('u1', 5, true), id: 'u1_w5_dup' }; // simulates an accidental stray duplicate
    const rows = buildExcelRows(students, [dup1, dup2]);
    expect(rows[0]['5주차']).toBe(1);
    expect(rows[0]['총 제출 수']).toBe(1);
  });

  it('produces one row per student, including students with zero submissions', () => {
    const students = [student('u1', '김한결', '1234567'), student('u2', '이서준', '2345678')];
    const rows = buildExcelRows(students, [submission('u1', 1, true)]);
    expect(rows).toHaveLength(2);
    const u2Row = rows.find((r) => r['학번'] === '2345678')!;
    expect(u2Row['총 제출 수']).toBe(0);
    expect(u2Row['정시 제출 수']).toBe(0);
  });

  it('recomputes punctuality from the server timestamp rather than trusting a stored claim', () => {
    const students = [student('u1', '김한결', '1234567')];
    // clientPunctualClaim says true, but the actual serverCreatedAt is outside the window.
    const win = getScheduledWindow(1, 3, '12:00', 60);
    const lateButClaimedPunctual: Submission = {
      ...submission('u1', 1, true),
      serverCreatedAt: new Date(win.end.getTime() + 999999),
      clientPunctualClaim: true,
    };
    const rows = buildExcelRows(students, [lateButClaimedPunctual]);
    expect(rows[0]['정시 제출 수']).toBe(0);
  });
});
