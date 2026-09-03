import { getScheduledWindow } from './date';
import type { GoalSnapshot, Submission } from '../types';

interface TimestampLike {
  toDate: () => Date;
}

function isTimestampLike(v: unknown): v is TimestampLike {
  return !!v && typeof v === 'object' && typeof (v as TimestampLike).toDate === 'function';
}

/**
 * The authoritative submission instant, used for grading-grade punctuality.
 * Always prefers the Firestore server timestamp (`serverCreatedAt`, set via
 * `serverTimestamp()` and enforced equal to `request.time` by firestore.rules)
 * over the client-supplied `submittedAt` string, because a student's device
 * clock is never trustworthy input for something that may carry grade weight.
 */
export function authoritativeSubmissionDate(sub: Pick<Submission, 'serverCreatedAt' | 'submittedAt'>): Date | null {
  if (sub.serverCreatedAt instanceof Date) return sub.serverCreatedAt;
  if (isTimestampLike(sub.serverCreatedAt)) return sub.serverCreatedAt.toDate();
  if (sub.submittedAt) {
    const d = new Date(sub.submittedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

type PunctualInput = Pick<Submission, 'serverCreatedAt' | 'submittedAt' | 'week' | 'goalSnapshot' | 'status' | 'clientPunctualClaim'>;

/**
 * Recomputes the punctual badge from server-trusted data for any real
 * submission (`status: 'submitted'`, always written by FirebaseBackend).
 * Never trusts a stored boolean flag there — grading-relevant punctuality
 * always comes from the goal snapshot + the server timestamp, never a
 * client-supplied claim.
 *
 * The one exception is `status: 'test'`, which ONLY ever comes from the
 * prototype/demo LocalBackend (production's FirebaseBackend never writes
 * that status). There, the tester's explicit "정시 배지 테스트" checkbox
 * (`clientPunctualClaim`) is honored as-is, because prototype submissions
 * intentionally happen outside the real semester dates and would otherwise
 * never be able to demonstrate the punctual-badge UI at all.
 */
export function isPunctualSubmission(sub: PunctualInput): boolean {
  if (sub.status === 'test') return !!sub.clientPunctualClaim;

  const d = authoritativeSubmissionDate(sub);
  if (!d) return false;
  const snap: GoalSnapshot | undefined = sub.goalSnapshot;
  if (!snap || (snap.weekday !== 0 && !snap.weekday) || !snap.startTime || !snap.duration) return false;
  const win = getScheduledWindow(Number(sub.week), Number(snap.weekday), snap.startTime, Number(snap.duration));
  return d >= win.start && d <= win.end;
}

export function punctualBadgeCount(subs: PunctualInput[]): number {
  return subs.filter((s) => isPunctualSubmission(s)).length;
}
