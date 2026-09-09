import { TOTAL_WEEKS } from '../../constants';
import { formatDateTime } from '../../utils/date';
import { authoritativeSubmissionDate, isPunctualSubmission } from '../../utils/punctual';
import { safeText } from '../../utils/text';
import { imgWithFallback } from '../../utils/imgFallback';
import { buildInstructorFeedItems } from '../../utils/instructorFeed';
import { paginate } from '../../utils/pagination';
import { backend } from '../../backend';
import { els } from '../dom';
import { state } from '../state';
import { characterMarkupForStage } from '../character';
import { getAdminData } from '../adminData';
import { openStudentHistory } from './admin';

const STUDENT_FEED_PAGE_SIZE = 8;
const INSTRUCTOR_FEED_PAGE_SIZE = 10;
const HOME_RECENT_FEED_MAX = 3;

function isInstructor(): boolean {
  return state.profile?.role === 'instructor';
}

export function renderFeedWeekFilter() {
  const opts = [0, ...Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1)];
  els.feedWeekFilter.innerHTML = opts
    .map((w) => `<button type="button" class="feed-week-chip ${state.selectedFeedWeek === w ? 'active' : ''}" data-feed-week="${w}">${w === 0 ? '전체' : w + '주차'}</button>`)
    .join('');
  els.feedWeekFilter.querySelectorAll<HTMLButtonElement>('[data-feed-week]').forEach((b) => {
    b.onclick = async () => {
      state.selectedFeedWeek = Number(b.dataset.feedWeek);
      state.feedPage = 1; // a new filter always starts back at page 1
      renderFeedWeekFilter();
      await loadPublicFeed();
    };
  });
}

export async function loadPublicFeed() {
  if (isInstructor()) {
    if (!els.mainScreen.classList.contains('hidden')) await renderInstructorFeed();
    return;
  }
  try {
    state.publicFeed = await backend.listFeed(state.selectedFeedWeek);
  } catch (e) {
    console.warn(e);
    state.publicFeed = [];
  }
  if (!els.mainScreen.classList.contains('hidden')) renderFeed();
}

export async function loadHomeRecentFeed() {
  try {
    // Fetches only the 3 posts the home widget actually shows, instead of
    // pulling the Feed tab's full page and slicing client-side.
    state.homeRecentFeed = await backend.listFeed(0, HOME_RECENT_FEED_MAX);
  } catch (e) {
    console.warn(e);
    state.homeRecentFeed = [];
  }
}

function feedCreatedAtDate(createdAt: unknown): Date {
  if (createdAt instanceof Date) return createdAt;
  if (createdAt && typeof createdAt === 'object' && 'toDate' in createdAt) {
    return (createdAt as { toDate(): Date }).toDate();
  }
  return new Date();
}

/**
 * Shared "이전 N / M 다음" control for both the student and instructor Feed.
 * Hidden entirely when everything fits on one page. `onChange` re-renders
 * the calling screen for the new page — it never appends: the previous
 * page's cards are replaced wholesale (see renderFeed()/renderInstructorFeed()
 * innerHTML assignment), so the DOM never accumulates more than one page's
 * worth of feed-card images at a time.
 */
function renderPaginationControls(page: number, totalPages: number, onChange: (nextPage: number) => void) {
  if (totalPages <= 1) {
    els.feedPagination.classList.add('hidden');
    els.feedPagination.innerHTML = '';
    return;
  }
  els.feedPagination.classList.remove('hidden');
  els.feedPagination.innerHTML = `<button type="button" class="feed-page-btn" data-dir="prev" ${page <= 1 ? 'disabled' : ''}>이전</button><span class="feed-page-info">${page} / ${totalPages}</span><button type="button" class="feed-page-btn" data-dir="next" ${page >= totalPages ? 'disabled' : ''}>다음</button>`;
  els.feedPagination.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((btn) => {
    btn.onclick = () => onChange(btn.dataset.dir === 'prev' ? page - 1 : page + 1);
  });
}

export function renderFeed() {
  renderFeedWeekFilter();
  els.feedSearchWrap.classList.add('hidden');
  els.feedNoticeText.textContent = '다른 학생의 인증은 익명으로 표시됩니다. 이름·학번·이메일은 공개되지 않습니다.';

  const { items, page, totalPages } = paginate(state.publicFeed, state.feedPage, STUDENT_FEED_PAGE_SIZE);
  state.feedPage = page;

  els.feedList.innerHTML =
    items
      .map((f) => {
        const submitted = feedCreatedAtDate(f.createdAt);
        return `<article class="feed-card">${imgWithFallback(f.photoURL, '익명 학습 인증', 'feed-img')}<div class="feed-body"><div class="feed-top"><div style="display:flex;align-items:center;gap:8px">${characterMarkupForStage(f.characterType || 'rabbit', f.characterStage || 1, 'small')}<div class="anon">${safeText(f.anonName || '익명 도전자')}</div></div><span class="tag accent">${Number(f.week)}주차</span></div><div class="feed-reflection">${safeText(f.reflection || '')}</div><div class="feed-date">${formatDateTime(submitted)}${f.punctualClaim ? ' <span class="punctual-chip">정시</span>' : ''}</div></div></article>`;
      })
      .join('') || `<div class="panel body-sm muted">${state.selectedFeedWeek ? state.selectedFeedWeek + '주차에 등록된 인증이 아직 없습니다.' : '아직 등록된 인증이 없습니다.'}</div>`;

  renderPaginationControls(page, totalPages, (nextPage) => {
    state.feedPage = nextPage;
    renderFeed();
  });
}

// --- instructor real-name feed (never touches the anonymous feedPosts collection) ---

let instructorSearchQuery = '';

async function renderInstructorFeed() {
  renderFeedWeekFilter();
  els.feedSearchWrap.classList.remove('hidden');
  els.feedSearchInput.value = instructorSearchQuery;
  els.feedNoticeText.textContent = '교수자 화면에서는 학생의 제출 기록이 실명으로 표시됩니다. 학생 간 피드에서는 익명으로 제공됩니다.';

  const { students, allSubs } = await getAdminData();
  const allItems = buildInstructorFeedItems(students, allSubs, { week: state.selectedFeedWeek, query: instructorSearchQuery });

  if (!allItems.length) {
    const q = instructorSearchQuery.trim();
    els.feedList.innerHTML = `<div class="panel body-sm muted">${q ? `"${safeText(q)}"와 일치하는 학생 제출 기록이 없습니다.` : state.selectedFeedWeek ? state.selectedFeedWeek + '주차에 제출된 기록이 없습니다.' : '제출된 기록이 없습니다.'}</div>`;
    els.feedPagination.classList.add('hidden');
    els.feedPagination.innerHTML = '';
    return;
  }

  // Fetching/holding all matching submissions' metadata in memory is fine at
  // this course's scale (up to ~1,500 total across a semester) — the thing
  // that must stay bounded is how many of them get turned into <img> DOM
  // nodes at once, which is what paginate() below limits.
  const { items, page, totalPages } = paginate(allItems, state.feedPage, INSTRUCTOR_FEED_PAGE_SIZE);
  state.feedPage = page;

  els.feedList.innerHTML = items
    .map(({ uid, name, studentId, characterType, characterStage, submission: s }) => {
      const badge = isPunctualSubmission(s);
      // Server-confirmed instant, never the client-supplied submittedAt string.
      const submittedTime = authoritativeSubmissionDate(s) ?? new Date(s.submittedAt);
      return `<article class="feed-card"><div class="feed-body" style="padding-bottom:0"><div class="feed-top"><div style="display:flex;align-items:center;gap:8px">${characterMarkupForStage(characterType, characterStage, 'small')}<div><div class="anon instructor-feed-name" data-history-uid="${safeText(uid)}">${safeText(name)}</div><div class="feed-student-id">${safeText(studentId)}</div></div></div><span class="tag accent">${Number(s.week)}주차</span></div></div>${imgWithFallback(s.photoURL, `${name} ${s.week}주차 인증샷`, 'feed-img')}<div class="feed-body"><div class="helper" style="margin:0 0 8px">제출 당시 목표 v${Number(s.goalVersion || 1)} · ${safeText(s.goalSnapshot?.goalText || '목표 기록 없음')}</div><div class="feed-reflection">${safeText(s.reflection || '(작성된 성찰이 없습니다)')}</div><div class="feed-date">${safeText(formatDateTime(submittedTime))}${badge ? ' <span class="punctual-chip">정시</span>' : ''}</div></div></article>`;
    })
    .join('');

  els.feedList.querySelectorAll<HTMLElement>('.instructor-feed-name').forEach((el) => {
    el.onclick = () => {
      const uid = el.dataset.historyUid;
      if (uid) void openStudentHistory(uid);
    };
  });

  renderPaginationControls(page, totalPages, (nextPage) => {
    state.feedPage = nextPage;
    void renderInstructorFeed();
  });
}

export function initInstructorFeedEvents() {
  els.feedSearchInput.oninput = () => {
    instructorSearchQuery = els.feedSearchInput.value;
    state.feedPage = 1; // a new search always starts back at page 1
    void renderInstructorFeed();
  };
}
