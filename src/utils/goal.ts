import { WEEKDAY_NAMES } from '../constants';
import type { GoalSettings } from '../types';

export function formatGoalSchedule(g: Partial<GoalSettings> | null | undefined): string {
  if (!g || (g.weekday !== 0 && !g.weekday)) return '-';
  const day = WEEKDAY_NAMES[Number(g.weekday)] ?? '-';
  const duration = Number(g.duration) || 0;
  return `매주 ${day}요일 ${g.startTime || '-'} · ${duration}분`;
}

export function goalSettingsChanged(a: GoalSettings | null | undefined, b: GoalSettings): boolean {
  if (!a) return true;
  return (
    String(a.goalText || '').trim() !== String(b.goalText || '').trim() ||
    Number(a.weekday) !== Number(b.weekday) ||
    String(a.startTime || '') !== String(b.startTime || '') ||
    Number(a.duration) !== Number(b.duration)
  );
}
