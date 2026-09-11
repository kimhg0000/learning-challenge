import { backend } from '../backend';
import type { Submission, UserProfile } from '../types';
import { sessionGuard } from './session';

export interface AdminData {
  students: UserProfile[];
  allSubs: Submission[];
}

// Shared between the instructor dashboard (관리 tab) and the instructor's
// real-name feed (피드 tab) — both need the same full student roster +
// every submission this semester, and there is no reason to pay for that
// ~2 full-collection read twice just because the instructor switched tabs.
let cache: AdminData | null = null;
export function clearAdminData(): void { cache = null; }

export async function getAdminData(options: { forceRefresh?: boolean } = {}): Promise<AdminData> {
  const isCurrent = sessionGuard();
  if (options.forceRefresh || !cache) {
    const [students, allSubs] = await Promise.all([backend.adminListStudents(), backend.adminListAllSubmissions()]);
    if (!isCurrent()) throw new Error('Session changed');
    cache = { students, allSubs };
  }
  return cache;
}
