import { PROGRAM_START, PROGRAM_END, TOTAL_WEEKS } from '../constants';

export const pad = (n: number): string => String(n).padStart(2, '0');

export function formatDate(d: Date): string {
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Test-only override hook. Not wired to any UI control — set it directly
 * (`globalThis.__QUEST_TEST_NOW = '2026-09-09T12:00:00+09:00'`) from a test
 * or devtools console to make date-dependent code (submission windows,
 * current-week calculation) behave as if "now" were a different real
 * instant. Used by tests/integration, where FirebaseBackend's real
 * Firestore server timestamp still reflects the actual clock — this only
 * overrides the CLIENT-side window pre-check in submitWeek(), it does not
 * and cannot affect what a security rule sees as request.time.
 */
declare global {
  // eslint-disable-next-line no-var
  var __QUEST_TEST_NOW: string | number | undefined;
}

export function now(): Date {
  return globalThis.__QUEST_TEST_NOW ? new Date(globalThis.__QUEST_TEST_NOW) : new Date();
}

export interface WeekBounds {
  start: Date;
  end: Date;
}

export function getWeekBounds(weekNo: number): WeekBounds {
  const start = new Date(PROGRAM_START);
  start.setDate(start.getDate() + (weekNo - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** The Monday-based date within a given week that corresponds to a goal's weekday (0=Sun..6=Sat). */
export function getScheduledDate(weekNo: number, weekday: number): Date {
  const { start } = getWeekBounds(weekNo); // Monday
  const mondayBased = weekday === 0 ? 6 : weekday - 1;
  const d = new Date(start);
  d.setDate(d.getDate() + mondayBased);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface ScheduledWindow {
  start: Date;
  end: Date;
}

export function getScheduledWindow(
  weekNo: number,
  weekday: number,
  startTime: string,
  duration: number,
): ScheduledWindow {
  const d = getScheduledDate(weekNo, Number(weekday));
  const [hh, mm] = String(startTime || '00:00').split(':').map(Number);
  d.setHours(hh || 0, mm || 0, 0, 0);
  const end = new Date(d.getTime() + (Number(duration) || 0) * 60000);
  return { start: d, end };
}

export function getCurrentProgramWeek(referenceNow: Date = now()): number {
  const t = startOfDay(referenceNow);
  if (t < startOfDay(PROGRAM_START)) return 1;
  if (t > startOfDay(PROGRAM_END)) return TOTAL_WEEKS;
  return Math.min(
    TOTAL_WEEKS,
    Math.max(1, Math.floor((t.getTime() - startOfDay(PROGRAM_START).getTime()) / (7 * 86400000)) + 1),
  );
}

/** Whether `referenceNow` falls within week `weekNo`'s Mon 00:00–Sun 23:59 submission window. */
export function isWithinSubmissionWindow(weekNo: number, referenceNow: Date = now()): boolean {
  const { start, end } = getWeekBounds(weekNo);
  return referenceNow >= start && referenceNow <= end;
}
