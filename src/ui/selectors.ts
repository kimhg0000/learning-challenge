import { DURATION_OPTIONS, PROGRAM_START, PROGRAM_END, TOTAL_WEEKS } from '../constants';
import { formatDate, pad } from '../utils/date';
import { els } from './dom';
import { state } from './state';
import { renderCharacterChoices } from './character';
import { renderFeedWeekFilter } from './screens/feed';

export function populateSelectors() {
  els.weekdayGrid.innerHTML = '';
  ['월', '화', '수', '목', '금', '토', '일'].forEach((name, i) => {
    const weekday = i === 6 ? 0 : i + 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'weekday-btn';
    b.textContent = name;
    b.dataset.weekday = String(weekday);
    b.onclick = () => {
      state.selectedWeekday = weekday;
      document.querySelectorAll<HTMLElement>('.weekday-btn').forEach((x) => x.classList.toggle('active', Number(x.dataset.weekday) === weekday));
    };
    els.weekdayGrid.appendChild(b);
  });

  els.startTime.innerHTML = '';
  for (let h = 7; h <= 22; h++) {
    for (const m of [0, 30]) {
      const val = `${pad(h)}:${pad(m)}`;
      els.startTime.add(new Option(val, val));
    }
  }

  els.duration.innerHTML = '';
  DURATION_OPTIONS.forEach((min) => {
    const label = min === 120 ? '2시간' : min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60 ? min % 60 + '분' : ''}`.trim() : `${min}분`;
    els.duration.add(new Option(label, String(min)));
  });

  els.adminWeekSelect.innerHTML = '';
  els.testWeekSelect.innerHTML = '';
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    els.adminWeekSelect.add(new Option(`${w}주차`, String(w)));
    els.testWeekSelect.add(new Option(`${w}주차`, String(w)));
  }
  els.testWeekSelect.value = String(state.prototypeWeek);

  els.programPeriodText.textContent = `${formatDate(PROGRAM_START)} ~ ${formatDate(PROGRAM_END)} · 총 ${TOTAL_WEEKS}주`;

  renderCharacterChoices();
  renderFeedWeekFilter();
}
