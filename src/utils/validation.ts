import { CHARACTER_TYPES, DURATION_OPTIONS } from '../constants';
import type { CharacterType, GoalSettings } from '../types';

/**
 * Student IDs are exactly 7 digits. There is no university SSO in this
 * course setup, so this is a *format* check only — it cannot verify the
 * number belongs to a real, currently-enrolled student. The realistic
 * mitigation for typos/impersonation without SSO is operational, not
 * technical: the instructor's admin dashboard shows every submitted
 * student ID next to the student's real name every week, so a wrong or
 * duplicate ID is visible and correctable well before the semester ends.
 */
export function isValidStudentId(studentId: string): boolean {
  return /^\d{7}$/.test(String(studentId ?? ''));
}

export function isValidName(name: string): boolean {
  return String(name ?? '').trim().length >= 2;
}

export function isValidCharacterType(v: string | undefined | null): v is CharacterType {
  return !!v && v in CHARACTER_TYPES;
}

export function isValidGoalText(goalText: string): boolean {
  return String(goalText ?? '').trim().length >= 10;
}

export function isValidReflection(reflection: string): boolean {
  return String(reflection ?? '').trim().length >= 10;
}

export function isValidDuration(duration: number): boolean {
  return DURATION_OPTIONS.includes(Number(duration)) && Number(duration) <= 120;
}

export function isValidWeekday(weekday: number | null | undefined): weekday is number {
  return weekday !== null && weekday !== undefined && weekday >= 0 && weekday <= 6;
}

export function isValidGoalSettings(g: Partial<GoalSettings>): boolean {
  return (
    isValidGoalText(g.goalText ?? '') &&
    isValidWeekday(g.weekday) &&
    !!g.startTime &&
    isValidDuration(g.duration ?? 0)
  );
}
