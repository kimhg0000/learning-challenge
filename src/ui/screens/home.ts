import { feedPhotoURL } from '../../utils/feedPhoto';
import { TOTAL_WEEKS, WEEKDAY_NAMES } from '../../constants';
import { formatDate, getScheduledWindow, getWeekBounds, pad } from '../../utils/date';
import { getGrowthState } from '../../utils/growth';
import { isPunctualSubmission, punctualBadgeCount } from '../../utils/punctual';
import { safeText } from '../../utils/text';
import { imgWithFallback } from '../../utils/imgFallback';
import { els } from '../dom';
import { state } from '../state';
import { characterMarkup } from '../character';
import { computeStreak, getActiveWeek, getWeekState } from '../weekState';

export function renderHome() {
  const profile = state.profile;
  if (!profile) return;
  const currentWeek = getActiveWeek();
  const wState = getWeekState(currentWeek);
  const { start: weekStart, end: weekEnd } = getWeekBounds(currentWeek);
  const scheduledWin = getScheduledWindow(currentWeek, profile.weekday, profile.startTime, profile.duration);
  const doneCount = state.submissions.length;
  const badgeCount = punctualBadgeCount(state.submissions);
  const growth = getGrowthState(doneCount);

  els.homeName.textContent = profile.name;
  els.homeAvatar.innerHTML = characterMarkup(profile.characterType, doneCount, 'small');
  els.homeWeekTag.textContent = `WEEK ${currentWeek}`;
  els.homeWeekTitle.textContent = `${currentWeek}주차`;
  els.homeGoal.textContent = profile.goalText;
  els.homeSchedule.textContent = `인증 가능 ${formatDate(weekStart)} 00:00 ~ ${formatDate(weekEnd)} 23:59`;
  els.homeDuration.textContent = `정시 배지 기준 · ${WEEKDAY_NAMES[scheduledWin.start.getDay()]}요일 ${profile.startTime} ~ ${pad(scheduledWin.end.getHours())}:${pad(scheduledWin.end.getMinutes())} (${profile.duration}분)`;
  els.homeProgressText.textContent = `${doneCount} / ${TOTAL_WEEKS}`;
  els.homeProgressFill.style.width = `${Math.min(100, (doneCount / TOTAL_WEEKS) * 100)}%`;
  els.metricCompleted.textContent = String(doneCount);
  els.metricBadges.textContent = String(badgeCount);
  els.metricStreak.textContent = String(computeStreak());

  els.growthAvatar.innerHTML = characterMarkup(profile.characterType, doneCount, 'large');
  els.growthLevel.textContent = `Lv.${growth.stage}`;
  els.growthStageName.textContent = growth.name;
  els.growthBadgeCount.textContent = `⏰ ${badgeCount}`;
  els.growthCharacterName.textContent = profile.name;
  els.growthXpText.textContent = `${growth.xp} XP`;
  els.growthXpFill.style.width = `${growth.progress}%`;
  els.growthNext.textContent = growth.next
    ? `다음 성장까지 ${growth.next.minCompleted - doneCount}주 · 정시 배지는 별도로 누적됩니다.`
    : '습관 장인에 도달했습니다! 남은 주차까지 완주해보세요.';

  if (wState.status === 'done' && wState.sub) {
    const badge = isPunctualSubmission(wState.sub);
    els.homeSubmitBtn.textContent = `이번 주 인증 완료 ${badge ? '⏰' : '✓'}`;
    els.homeSubmitBtn.disabled = true;
    els.homeSubmitHelp.textContent = badge ? '정해둔 시간 안에 인증해 정시 실천 배지를 획득했습니다.' : '나의 챌린지 기록에서 인증을 다시 확인할 수 있어요.';
  } else if (wState.status === 'test') {
    els.homeSubmitBtn.textContent = `${currentWeek}주차 테스트 인증하기 📸`;
    els.homeSubmitBtn.disabled = false;
    els.homeSubmitHelp.textContent = '프로토타입 테스트 모드: 실제 날짜 제한 없이 주차/배지/성장을 확인할 수 있습니다.';
  } else if (wState.status === 'future') {
    els.homeSubmitBtn.textContent = '아직 인증 기간이 아니에요';
    els.homeSubmitBtn.disabled = true;
    els.homeSubmitHelp.textContent = `${formatDate(weekStart)} 00:00부터 인증할 수 있습니다.`;
  } else if (wState.status === 'expired') {
    els.homeSubmitBtn.textContent = '인증 기간이 종료됐어요';
    els.homeSubmitBtn.disabled = true;
    els.homeSubmitHelp.textContent = `${formatDate(weekEnd)} 23:59에 마감되어 이제 제출할 수 없습니다.`;
  } else {
    els.homeSubmitBtn.textContent = '이번 주 인증하기 📸';
    els.homeSubmitBtn.disabled = false;
    els.homeSubmitHelp.textContent = `이번 주 일요일 23:59까지 언제든 제출 가능 · ${WEEKDAY_NAMES[scheduledWin.start.getDay()]}요일 ${profile.startTime}~${pad(scheduledWin.end.getHours())}:${pad(scheduledWin.end.getMinutes())} 제출 시 ⏰ 배지`;
  }

  els.homeMiniFeed.innerHTML =
    state.homeRecentFeed
      .slice(0, 3)
      .map(
        (f) =>
          `<div class="mini-feed-item">${imgWithFallback(feedPhotoURL(f.photoURL), '익명 인증', '')}<div><strong>${safeText(f.anonName || '익명 도전자')} · ${Number(f.week)}주차 ${f.punctualClaim ? '⏰' : ''}</strong><p>${safeText(f.reflection || '')}</p></div></div>`,
      )
      .join('') || '<div class="panel body-sm muted" style="padding:13px">아직 공개된 인증이 없습니다.</div>';
}
