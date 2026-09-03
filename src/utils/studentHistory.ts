import { TOTAL_WEEKS } from '../constants';
import { getWeekBounds, now } from './date';
import type { Submission } from '../types';

export type StudentWeekStatus = 'submitted' | 'missing' | 'future';

export interface StudentWeekRow {
  week: number;
  status: StudentWeekStatus;
  sub?: Submission;
}

/**
 * Per-week status for one student's full semester, for the instructor's
 * per-student history modal. Mirrors ui/weekState.ts's getWeekState(), which
 * answers the same question for the CURRENTLY SIGNED-IN student by reading
 * `state.submissions` — this instead takes an arbitrary submissions list, so
 * an instructor can compute it for any student they select without touching
 * that student's own client-side state.
 */
export function computeStudentWeekRows(submissions: Submission[], referenceNow: Date = now()): StudentWeekRow[] {
  const byWeek = new Map(submissions.map((s) => [Number(s.week), s]));
  const rows: StudentWeekRow[] = [];
  for (let week = 1; week <= TOTAL_WEEKS; week++) {
    const sub = byWeek.get(week);
    if (sub) {
      rows.push({ week, status: 'submitted', sub });
      continue;
    }
    const { start } = getWeekBounds(week);
    rows.push({ week, status: referenceNow < start ? 'future' : 'missing' });
  }
  return rows;
}
