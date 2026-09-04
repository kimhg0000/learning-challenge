import { describe, expect, it } from 'vitest';
import { isPunctualSubmission, punctualBadgeCount, authoritativeSubmissionDate } from '../../src/utils/punctual';
import { getWeekBounds, getScheduledWindow } from '../../src/utils/date';

function submissionAt(week: number, when: Date, goal = { version: 1, goalText: 'x', weekday: 3, startTime: '12:00', duration: 60 }) {
  return {
    week,
    goalSnapshot: goal,
    submittedAt: when.toISOString(),
    serverCreatedAt: when,
    status: 'submitted' as const,
    clientPunctualClaim: false, // irrelevant for status:'submitted' — always recomputed from the server timestamp
  };
}

describe('authoritativeSubmissionDate', () => {
  it('prefers a Firestore-Timestamp-like serverCreatedAt over the client submittedAt string', () => {
    const trusted = new Date('2026-09-09T12:10:00+09:00');
    const spoofed = '2020-01-01T00:00:00.000Z'; // what a tampered client might claim
    const sub = { serverCreatedAt: { toDate: () => trusted }, submittedAt: spoofed };
    expect(authoritativeSubmissionDate(sub)!.getTime()).toBe(trusted.getTime());
  });

  it('falls back to submittedAt only when no server timestamp is present (local/demo mode)', () => {
    const iso = '2026-09-09T12:10:00.000Z';
    const sub = { serverCreatedAt: undefined, submittedAt: iso };
    expect(authoritativeSubmissionDate(sub)?.toISOString()).toBe(iso);
  });
});

describe('isPunctualSubmission', () => {
  it('awards the badge for a submission inside the exact scheduled window', () => {
    const win = getScheduledWindow(2, 3, '12:00', 60);
    const sub = submissionAt(2, new Date(win.start.getTime() + 5 * 60000));
    expect(isPunctualSubmission(sub)).toBe(true);
  });

  it('does NOT award the badge for a submission on a different day of the same week', () => {
    const { start } = getWeekBounds(2); // Monday
    const mondaySubmission = submissionAt(2, new Date(start.getTime() + 9 * 3600000));
    expect(isPunctualSubmission(mondaySubmission)).toBe(false);
  });

  it('does NOT award the badge just outside the end of the window', () => {
    const win = getScheduledWindow(2, 3, '12:00', 60);
    const sub = submissionAt(2, new Date(win.end.getTime() + 60000));
    expect(isPunctualSubmission(sub)).toBe(false);
  });

  it('is false with no usable goal snapshot', () => {
    const sub = {
      week: 1, goalSnapshot: undefined, submittedAt: new Date().toISOString(), serverCreatedAt: new Date(),
      status: 'submitted' as const, clientPunctualClaim: false,
    };
    expect(isPunctualSubmission(sub)).toBe(false);
  });

  it('judges punctuality from the server timestamp even when the client-supplied submittedAt disagrees (device clock tampering has no effect)', () => {
    const win = getScheduledWindow(2, 3, '19:00', 60); // Wed 19:00-20:00
    const realServerTime = new Date(win.start.getTime() + 35 * 60000); // 19:35, real server time -> punctual
    const spoofedSubmittedAt = new Date(win.end.getTime() + 5 * 3600000).toISOString(); // claims a much later, non-punctual time
    const sub = {
      week: 2,
      goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60 },
      submittedAt: spoofedSubmittedAt,
      serverCreatedAt: realServerTime,
      status: 'submitted' as const,
      clientPunctualClaim: false,
    };
    expect(isPunctualSubmission(sub)).toBe(true);
  });

  it("status:'test' (prototype-mode only) honors the tester's explicit override instead of recomputing from timestamps", () => {
    const { start } = getWeekBounds(1); // deliberately outside any scheduled window
    const outsideWindowButClaimedPunctual = {
      ...submissionAt(1, new Date(start.getTime() + 3 * 3600000)),
      status: 'test' as const,
      clientPunctualClaim: true,
    };
    expect(isPunctualSubmission(outsideWindowButClaimedPunctual)).toBe(true);

    const claimedNotPunctual = { ...outsideWindowButClaimedPunctual, clientPunctualClaim: false };
    expect(isPunctualSubmission(claimedNotPunctual)).toBe(false);
  });
});

describe('punctualBadgeCount', () => {
  it('counts only the punctual ones across a list of submissions', () => {
    const winA = getScheduledWindow(1, 3, '12:00', 60);
    const winB = getScheduledWindow(2, 3, '12:00', 60);
    const { start: week3Start } = getWeekBounds(3);
    const subs = [
      submissionAt(1, new Date(winA.start.getTime() + 60000)), // punctual
      submissionAt(2, new Date(winB.end.getTime() + 3600000)), // late in-window-week but outside time slot
      submissionAt(3, new Date(week3Start.getTime() + 10000)), // Monday morning, not the scheduled slot
    ];
    expect(punctualBadgeCount(subs)).toBe(1);
  });
});
