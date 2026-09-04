import { describe, expect, it } from 'vitest';
import { getGrowthState } from '../../src/utils/growth';

describe('getGrowthState', () => {
  // Stage 1: 0-2, Stage 2: 3-5, Stage 3: 6-9, Stage 4: 10-14, Stage 5: 15 only.
  it.each([
    [0, 1], [1, 1], [2, 1],
    [3, 2], [4, 2], [5, 2],
    [6, 3], [8, 3], [9, 3],
    [10, 4], [12, 4], [14, 4],
    [15, 5],
  ])('completed=%i -> stage %i', (completed, stage) => {
    expect(getGrowthState(completed).stage).toBe(stage);
  });

  it('14 completions is still stage 4, not stage 5 — only reaching 15 (every week) unlocks stage 5', () => {
    expect(getGrowthState(14).stage).toBe(4);
    expect(getGrowthState(15).stage).toBe(5);
  });

  it('caps completed count at TOTAL_WEEKS even if given a larger number', () => {
    expect(getGrowthState(999).completed).toBe(15);
    expect(getGrowthState(999).stage).toBe(5);
  });

  it('never goes negative for bad input', () => {
    expect(getGrowthState(-5).completed).toBe(0);
    expect(getGrowthState(-5).stage).toBe(1);
  });

  it('reports 100% progress at the final stage', () => {
    expect(getGrowthState(15).progress).toBe(100);
  });

  it('xp is always completed * 100', () => {
    expect(getGrowthState(7).xp).toBe(700);
  });

  it('Stage 5\'s user-facing label is "습관 장인", not the old system-sounding "최종 성장형"', () => {
    expect(getGrowthState(15).name).toBe('습관 장인');
    expect(getGrowthState(15).name).not.toBe('최종 성장형');
  });
});
