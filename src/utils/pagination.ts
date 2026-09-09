export interface Page<T> {
  items: T[];
  /** Clamped to [1, totalPages] — never out of range even if the caller passes a stale page number after the underlying list shrinks (e.g. a filter narrows the results). */
  page: number;
  totalPages: number;
}

/**
 * Slices `items` into one page, always returning a valid (clamped) page
 * number and a totalPages of at least 1 (even for an empty list) so callers
 * never have to special-case "no results" separately from "page out of range".
 */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: clampedPage, totalPages };
}
