import { TOTAL_WEEKS, WEEKDAY_NAMES } from '../../constants';
import { formatDate, getScheduledWindow, pad } from '../../utils/date';
import { isPunctualSubmission } from '../../utils/punctual';
import { els, toast } from '../dom';
import { state } from '../state';
import { getActiveWeek, getWeekState } from '../weekState';
import { openDetail, openSubmission } from '../modals';

export function renderWeeks() {
  const profile = state.profile;
  if (!profile) return;
  const current = getActiveWeek();
  els.weekList.innerHTML = '';
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const st = getWeekState(w);
    const { start, end } = st;
    const scheduledWin = getScheduledWindow(w, profile.weekday, profile.startTime, profile.duration);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `week-row ${w === current ? 'current' : ''} ${st.status === 'done' ? 'done' : ''} ${st.status === 'expired' ? 'missed' : ''}`;

    let statusHtml = '';
    if (st.status === 'done') statusHtml = `<span class="tag green">완료 ${st.sub && isPunctualSubmission(st.sub) ? '⏰' : ''}</span>`;
    else if (st.status === 'test') statusHtml = '<span class="tag yellow">테스트</span>';
    else if (st.status === 'open') statusHtml = '<span class="tag accent">인증 가능</span>';
    else if (st.status === 'expired') statusHtml = '<span class="tag yellow">기간 종료</span>';
    else statusHtml = '<span class="tag">예정</span>';

    card.innerHTML = `<div class="week-row-body"><div class="week-row-label"><strong>${w}주차 · ${formatDate(start)} ~ ${formatDate(end)}</strong><span>정시 배지 · ${WEEKDAY_NAMES[scheduledWin.start.getDay()]} ${profile.startTime}~${pad(scheduledWin.end.getHours())}:${pad(scheduledWin.end.getMinutes())}</span></div>${statusHtml}</div>`;
    card.onclick = () => {
      if (st.status === 'done' && st.sub) openDetail(st.sub);
      else if (st.status === 'test' || st.status === 'open') openSubmission(w);
      else if (st.status === 'expired') toast('이 주차는 인증 기간이 종료되어 더 이상 제출할 수 없습니다.', 'error');
      else toast('아직 해당 주차의 인증 기간이 아닙니다.');
    };
    els.weekList.appendChild(card);
  }
}
