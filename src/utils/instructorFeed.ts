import { getGrowthState } from './growth';
import { authoritativeSubmissionDate } from './punctual';
import type { CharacterType, Submission, UserProfile } from '../types';

export interface InstructorFeedItem {
  uid: string;
  name: string;
  studentId: string;
  characterType: CharacterType;
  characterStage: number;
  submission: Submission;
}

/**
 * Builds the instructor-only real-name feed by joining already-fetched
 * private `submissions` with the `users` roster — never the public,
 * anonymous `feedPosts` collection, which must never carry a name/studentId
 * (see firestore.rules feedPosts.create hasOnly()). This is what keeps the
 * student-facing anonymous feed's privacy guarantee completely untouched:
 * this function only ever runs against data an instructor already has
 * rules-gated access to (adminListStudents()/adminListAllSubmissions()).
 *
 * Sorting: with no search query, submissions are ordered newest-first (the
 * usual "what's happening now" feed reading order). Once a search narrows
 * the results down to one or a few specific students, they're ordered by
 * week ascending instead — reading one student's own 15-week journey in
 * the order they lived it is more useful than reverse-chronological.
 */
export function buildInstructorFeedItems(
  students: UserProfile[],
  allSubs: Submission[],
  options: { week: number; query: string },
): InstructorFeedItem[] {
  const byUid = new Map(students.map((s) => [s.uid, s]));
  const q = options.query.trim().toLowerCase();

  const matching = allSubs.filter((s) => {
    if (options.week && Number(s.week) !== options.week) return false;
    if (!q) return true;
    const st = byUid.get(s.userId);
    return !!st && ((st.name || '').toLowerCase().includes(q) || (st.studentId || '').includes(q));
  });

  const items = matching.map((submission) => {
    const st = byUid.get(submission.userId);
    const completedCount = allSubs.filter((s) => s.userId === submission.userId).length;
    return {
      uid: submission.userId,
      name: st?.name || '이름 미입력',
      studentId: st?.studentId || '학번 미입력',
      characterType: st?.characterType || 'rabbit',
      characterStage: getGrowthState(completedCount).stage,
      submission,
    };
  });

  if (q) {
    items.sort((a, b) => Number(a.submission.week) - Number(b.submission.week));
  } else {
    // Ordered by the server-confirmed submission instant, never the
    // client-supplied submittedAt string a device's clock could misreport.
    const time = (s: Submission) => (authoritativeSubmissionDate(s) ?? new Date(s.submittedAt)).getTime();
    items.sort((a, b) => time(b.submission) - time(a.submission));
  }
  return items;
}
