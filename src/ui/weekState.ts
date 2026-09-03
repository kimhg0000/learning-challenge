import { PROTOTYPE_MODE } from '../config';
import { getCurrentProgramWeek, getWeekBounds, now } from '../utils/date';
import { state } from './state';
import type { WeekState } from '../types';

export function getActiveWeek(): number {
  return PROTOTYPE_MODE ? state.prototypeWeek : getCurrentProgramWeek();
}

export function getWeekState(weekNo: number): WeekState {
  const sub = state.submissions.find((s) => Number(s.week) === weekNo);
  const { start, end } = getWeekBounds(weekNo);
  if (sub) return { status: 'done', sub, start, end };
  if (PROTOTYPE_MODE) return { status: 'test', start, end };
  const t = now();
  if (t < start) return { status: 'future', start, end };
  if (t > end) return { status: 'expired', start, end };
  return { status: 'open', start, end };
}

export function computeStreak(): number {
  let streak = 0;
  let prev: number | null = null;
  const sorted = [...state.submissions].sort((a, b) => Number(a.week) - Number(b.week));
  for (const s of sorted) {
    if (prev === null || Number(s.week) === prev + 1) streak++;
    else streak = 1;
    prev = Number(s.week);
  }
  return streak;
}
