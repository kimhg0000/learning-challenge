import { describe, expect, it } from 'vitest';
import { getGrowthState } from '../../src/utils/growth';

describe('getGrowthState', () => {
  it.each([
    [0, 1], [2, 1],
    [3, 2], [5, 2],
    [6, 3], [9, 3],
    [10, 4], [12, 4],
    [13, 5], [15, 5],
  ])('completed=%i -> stage %i', (completed, stage) => {
    expect(getGrowthState(completed).stage).toBe(stage);
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
});
