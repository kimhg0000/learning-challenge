import { TOTAL_WEEKS } from '../../constants';
import { formatDateTime } from '../../utils/date';
import { safeText } from '../../utils/text';
import { backend } from '../../backend';
import { els } from '../dom';
import { state } from '../state';
import { characterMarkupForStage } from '../character';

export function renderFeedWeekFilter() {
  const opts = [0, ...Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1)];
  els.feedWeekFilter.innerHTML = opts
    .map((w) => `<button type="button" class="feed-week-chip ${state.selectedFeedWeek === w ? 'active' : ''}" data-feed-week="${w}">${w === 0 ? '전체' : w + '주차'}</button>`)
    .join('');
  els.feedWeekFilter.querySelectorAll<HTMLButtonElement>('[data-feed-week]').forEach((b) => {
    b.onclick = async () => {
      state.selectedFeedWeek = Number(b.dataset.feedWeek);
      renderFeedWeekFilter();
      await loadPublicFeed();
    };
  });
}

export async function loadPublicFeed() {
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
    state.homeRecentFeed = (await backend.listFeed(0)).slice(0, 3);
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

export function renderFeed() {
  renderFeedWeekFilter();
  els.feedList.innerHTML =
    state.publicFeed
      .map((f) => {
        const submitted = feedCreatedAtDate(f.createdAt);
        return `<article class="feed-card"><img class="feed-img" src="${safeText(f.photoURL || '')}" alt="익명 학습 인증"><div class="feed-body"><div class="feed-top"><div style="display:flex;align-items:center;gap:8px">${characterMarkupForStage(f.characterType || 'rabbit', f.characterStage || 1, 'small')}<div class="anon">${safeText(f.anonName || '익명 도전자')}</div></div><span class="tag blue">${Number(f.week)}주차</span></div>${f.punctualClaim ? '<div style="margin-top:8px"><span class="tag yellow">⏰ 정시 실천 배지</span></div>' : ''}<div class="feed-reflection">${safeText(f.reflection || '')}</div><div class="feed-date">${formatDateTime(submitted)}</div></div></article>`;
      })
      .join('') || `<div class="panel body-sm muted">${state.selectedFeedWeek ? state.selectedFeedWeek + '주차에 등록된 인증이 아직 없습니다.' : '아직 등록된 인증이 없습니다.'}</div>`;
}
