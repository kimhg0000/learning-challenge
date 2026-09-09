import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedPost, Submission, UserProfile } from '../../src/types';

// Same jsdom-body-from-index.html + mocked backend pattern as
// submissionTimeDisplay.test.ts — feed.ts (and, transitively, admin.ts)
// resolve `els` from index.html and import ../../backend/../adminData at
// module scope.
document.body.innerHTML = readFileSync('index.html', 'utf8');

vi.mock('../../src/backend', () => ({
  backend: { submitWeek: vi.fn(), listFeed: vi.fn(), adminListStudents: vi.fn(), adminListAllSubmissions: vi.fn(), adminDeleteStudent: vi.fn() },
}));

const mockGetAdminData = vi.fn();
vi.mock('../../src/ui/adminData', () => ({
  getAdminData: (...args: unknown[]) => mockGetAdminData(...args),
}));

let state: typeof import('../../src/ui/state').state;
let els: typeof import('../../src/ui/dom').els;
let renderFeed: typeof import('../../src/ui/screens/feed').renderFeed;
let renderFeedWeekFilter: typeof import('../../src/ui/screens/feed').renderFeedWeekFilter;
let loadPublicFeed: typeof import('../../src/ui/screens/feed').loadPublicFeed;
let loadHomeRecentFeed: typeof import('../../src/ui/screens/feed').loadHomeRecentFeed;
let initInstructorFeedEvents: typeof import('../../src/ui/screens/feed').initInstructorFeedEvents;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ state } = await import('../../src/ui/state'));
  ({ els } = await import('../../src/ui/dom'));
  ({ renderFeed, renderFeedWeekFilter, loadPublicFeed, loadHomeRecentFeed, initInstructorFeedEvents } = await import('../../src/ui/screens/feed'));
  els.mainScreen.classList.remove('hidden');
});

function feedPost(i: number, overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: `f${i}`, anonName: `도전자 ${i}`, semesterId: 'sem', week: 1,
    reflection: `${i}번째 성찰입니다.`, photoURL: `https://example.com/${i}.jpg`,
    characterType: 'rabbit', characterStage: 1, punctualClaim: false,
    createdAt: new Date(2026, 8, 1 + i),
    ...overrides,
  };
}

function countFeedCards(html: string): number {
  return (html.match(/class="feed-card"/g) || []).length;
}

describe('student Feed pagination (renderFeed)', () => {
  it('renders at most 8 cards (the student page size) even when many more posts are available', () => {
    state.selectedFeedWeek = 0;
    state.feedPage = 1;
    state.publicFeed = Array.from({ length: 23 }, (_, i) => feedPost(i));
    renderFeed();
    expect(countFeedCards(els.feedList.innerHTML)).toBeLessThanOrEqual(8);
  });

  it('every rendered feed image is lazy-loaded', () => {
    state.publicFeed = Array.from({ length: 5 }, (_, i) => feedPost(i));
    state.feedPage = 1;
    renderFeed();
    expect(els.feedList.innerHTML).toContain('loading="lazy"');
    expect(els.feedList.innerHTML).toContain('decoding="async"');
  });

  it('shows pagination controls with the current/total page count when more than one page exists', () => {
    state.publicFeed = Array.from({ length: 23 }, (_, i) => feedPost(i));
    state.feedPage = 1;
    renderFeed();
    expect(els.feedPagination.classList.contains('hidden')).toBe(false);
    expect(els.feedPagination.textContent).toContain('1 / 3');
  });

  it('hides pagination controls entirely when everything fits on one page', () => {
    state.publicFeed = Array.from({ length: 3 }, (_, i) => feedPost(i));
    state.feedPage = 1;
    renderFeed();
    expect(els.feedPagination.classList.contains('hidden')).toBe(true);
  });

  it('moving to the next page replaces the DOM cards instead of appending — the previous page never accumulates', () => {
    state.publicFeed = Array.from({ length: 16 }, (_, i) => feedPost(i, { reflection: `카드-${i}` }));
    state.feedPage = 1;
    renderFeed();
    expect(els.feedList.innerHTML).toContain('카드-0');
    expect(els.feedList.innerHTML).not.toContain('카드-8');

    const nextBtn = els.feedPagination.querySelector<HTMLButtonElement>('[data-dir="next"]')!;
    nextBtn.click();

    expect(state.feedPage).toBe(2);
    expect(countFeedCards(els.feedList.innerHTML)).toBeLessThanOrEqual(8);
    expect(els.feedList.innerHTML).toContain('카드-8'); // new page's card present
    expect(els.feedList.innerHTML).not.toContain('카드-0'); // old page's card is gone, not accumulated
  });

  it('changing the week filter resets back to page 1', async () => {
    const { backend } = await import('../../src/backend');
    (backend.listFeed as ReturnType<typeof vi.fn>).mockResolvedValue(Array.from({ length: 20 }, (_, i) => feedPost(i, { week: 2 })));
    state.feedPage = 3;
    state.selectedFeedWeek = 0;
    renderFeedWeekFilter();

    const weekChip = els.feedWeekFilter.querySelector<HTMLButtonElement>('[data-feed-week="2"]')!;
    await (weekChip.onclick as unknown as () => Promise<void>)();

    expect(state.selectedFeedWeek).toBe(2);
    expect(state.feedPage).toBe(1);
  });
});

describe('home recent feed query (loadHomeRecentFeed)', () => {
  it('asks the backend for at most 3 results directly, instead of fetching a full page and slicing client-side', async () => {
    const { backend } = await import('../../src/backend');
    (backend.listFeed as ReturnType<typeof vi.fn>).mockResolvedValue([feedPost(1), feedPost(2), feedPost(3)]);
    await loadHomeRecentFeed();
    expect(backend.listFeed).toHaveBeenCalledWith(0, 3);
    expect(state.homeRecentFeed).toHaveLength(3);
  });
});

describe('instructor Feed pagination (renderInstructorFeed, via loadPublicFeed)', () => {
  function instructorProfile(): UserProfile {
    return {
      uid: 'instructor-1', name: '교수자', studentId: '', email: 'prof@univ.example',
      characterType: 'rabbit', anonName: 'x', role: 'instructor', semesterId: 'sem',
      currentGoalVersion: 1, goalText: '', weekday: 1, startTime: '09:00', duration: 30,
      goalCreatedAt: '', updatedAt: '', createdAt: '',
    };
  }

  function studentProfile(uid: string, name: string, studentId: string): UserProfile {
    return {
      uid, name, studentId, email: `${uid}@student.example`,
      characterType: 'fox', anonName: `도전자-${uid}`, role: 'student', semesterId: 'sem',
      currentGoalVersion: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60,
      goalCreatedAt: '', updatedAt: '', createdAt: '',
    };
  }

  function submissionFor(uid: string, week: number): Submission {
    return {
      id: `${uid}_sem_w${week}`, userId: uid, semesterId: 'sem', week, goalVersion: 1,
      goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60 },
      reflection: `${uid}-${week}주차 성찰`, photoURL: `https://example.com/${uid}-${week}.jpg`, photoStoragePath: 'p',
      submittedAt: '2026-09-01T00:00:00.000Z', serverCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
      clientPunctualClaim: false, status: 'submitted',
    };
  }

  beforeEach(() => {
    state.profile = instructorProfile();
    const students = Array.from({ length: 30 }, (_, i) => studentProfile(`u${i}`, `학생${i}`, String(1000000 + i)));
    const allSubs = students.map((s) => submissionFor(s.uid, 1)); // 30 submissions, one per student, all week 1
    mockGetAdminData.mockResolvedValue({ students, allSubs });
  });

  it('renders at most 10 cards (the instructor page size) even with far more matching submissions', async () => {
    state.selectedFeedWeek = 0;
    state.feedPage = 1;
    await loadPublicFeed();
    expect(countFeedCards(els.feedList.innerHTML)).toBeLessThanOrEqual(10);
  });

  it('every rendered instructor feed image is lazy-loaded', async () => {
    state.feedPage = 1;
    await loadPublicFeed();
    expect(els.feedList.innerHTML).toContain('loading="lazy"');
    expect(els.feedList.innerHTML).toContain('decoding="async"');
  });

  it('shows a 1/3 pagination control for 30 items at page size 10', async () => {
    state.feedPage = 1;
    await loadPublicFeed();
    expect(els.feedPagination.classList.contains('hidden')).toBe(false);
    expect(els.feedPagination.textContent).toContain('1 / 3');
  });

  it('changing the search query resets back to page 1', async () => {
    initInstructorFeedEvents();
    state.feedPage = 3;
    els.feedSearchInput.value = '학생1';
    els.feedSearchInput.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(mockGetAdminData).toHaveBeenCalled());
    expect(state.feedPage).toBe(1);
  });
});
