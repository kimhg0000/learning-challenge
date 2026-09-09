import { describe, expect, it } from 'vitest';
import { paginate } from '../../src/utils/pagination';

describe('paginate', () => {
  it('slices to at most pageSize items for the requested page', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const p1 = paginate(items, 1, 8);
    expect(p1.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const p2 = paginate(items, 2, 8);
    expect(p2.items).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    const p3 = paginate(items, 3, 8);
    expect(p3.items).toEqual([16, 17, 18, 19, 20, 21, 22]); // last page is a partial page, never padded
  });

  it('computes totalPages by dividing the list length by pageSize, rounding up', () => {
    expect(paginate(Array.from({ length: 23 }, (_, i) => i), 1, 8).totalPages).toBe(3);
    expect(paginate(Array.from({ length: 24 }, (_, i) => i), 1, 8).totalPages).toBe(3);
    expect(paginate(Array.from({ length: 25 }, (_, i) => i), 1, 8).totalPages).toBe(4);
  });

  it('an empty list is always exactly 1 page with 0 items — never 0 pages or an error', () => {
    const result = paginate([] as number[], 1, 8);
    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
  });

  it('clamps a page number below 1 or above the last real page back into range', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(paginate(items, 0, 8).page).toBe(1);
    expect(paginate(items, -5, 8).page).toBe(1);
    expect(paginate(items, 99, 8).page).toBe(2); // only 2 pages exist for 10 items at pageSize 8
  });

  it('a page beyond range after the underlying list shrinks (e.g. a new filter) clamps to the new last page, never an empty crash', () => {
    const shrunk = Array.from({ length: 3 }, (_, i) => i);
    const result = paginate(shrunk, 5, 8); // caller was on page 5 of a much longer previous list
    expect(result.page).toBe(1);
    expect(result.items).toEqual([0, 1, 2]);
  });
});
