import { GROWTH_STAGES, TOTAL_WEEKS, XP_PER_COMPLETION, type GrowthStageDef } from '../constants';

export interface GrowthState extends GrowthStageDef {
  xp: number;
  completed: number;
  next: GrowthStageDef | null;
  progress: number; // 0-100, progress toward `next`
}

export function getGrowthState(completedCount = 0): GrowthState {
  const completed = Math.max(0, Math.min(TOTAL_WEEKS, Number(completedCount) || 0));
  const xp = completed * XP_PER_COMPLETION;
  let info: GrowthStageDef = GROWTH_STAGES[0];
  for (const st of GROWTH_STAGES) {
    if (completed >= st.minCompleted) info = st;
  }
  const idx = GROWTH_STAGES.findIndex((st) => st.stage === info.stage);
  const next = GROWTH_STAGES[idx + 1] ?? null;
  const progress = next
    ? Math.max(0, Math.min(100, ((xp - info.minXp) / (next.minXp - info.minXp)) * 100))
    : 100;
  return { ...info, xp, completed, next, progress };
}
