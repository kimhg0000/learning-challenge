import { formatDate, formatDateTime } from '../../utils/date';
import { getGrowthState } from '../../utils/growth';
import { isPunctualSubmission } from '../../utils/punctual';
import { safeText } from '../../utils/text';
import { formatGoalSchedule } from '../../utils/goal';
import { downloadSemesterExcel } from '../../admin/excelExport';
import { backend } from '../../backend';
import type { GoalVersion, Submission, UserProfile } from '../../types';
import { els, toast } from '../dom';
import { getWeekBounds } from '../../utils/date';
import { characterMarkup } from '../character';

function goalHistoryHtml(history: GoalVersion[]): string {
  if (!history.length) return '<div class="admin-history-item muted">이력 없음</div>';
  const latest = Number(history[history.length - 1]?.version || history.length);
  return [...history]
    .reverse()
    .map((h) => {
      const d = new Date(h.changedAt || Date.now());
      const current = Number(h.version) === latest;
      return `<div class="admin-history-item"><b>v${Number(h.version)}${current ? ' · 현재' : ''}</b> · ${safeText(formatDateTime(d))}<br>${safeText(h.goalText || '')}<br><span class="muted">${safeText(formatGoalSchedule(h))}</span></div>`;
    })
    .join('');
}

export async function loadAdminDashboard() {
  const week = Number(els.adminWeekSelect.value || 1) || 1;
  els.adminWeekSelect.value = String(week);
  const { start, end } = getWeekBounds(week);
  els.adminWeekDate.textContent = `${formatDate(start)} 00:00 ~ ${formatDate(end)} 23:59 · 이 기간 안에는 어느 요일에 제출해도 정상 완료입니다.`;

  try {
    const [students, allSubs] = await Promise.all([backend.adminListStudents(), backend.adminListAllSubmissions()]);
    const weekSubs = allSubs.filter((s) => Number(s.week) === week);
    renderAdminRows(students, weekSubs, allSubs);
  } catch (err) {
    console.error(err);
    toast('교수자 현황을 불러오지 못했습니다. Firestore 보안규칙과 instructorAllowlist 설정을 확인해주세요.', 'error');
  }
}

function renderAdminRows(students: UserProfile[], weekSubs: Submission[], allSubs: Submission[]) {
  const byUid = new Map(weekSubs.map((s) => [s.userId, s]));
  els.adminTotal.textContent = String(students.length);
  els.adminSubmitted.textContent = String(weekSubs.length);
  els.adminMissing.textContent = String(Math.max(0, students.length - weekSubs.length));
  els.adminPunctual.textContent = String(weekSubs.filter((s) => isPunctualSubmission(s)).length);

  const rows = [...students]
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
    .map((st) => {
      const userSubs = allSubs.filter((x) => x.userId === st.uid);
      const s = byUid.get(st.uid);
      const punctualTotal = userSubs.filter((x) => isPunctualSubmission(x)).length;
      const growth = getGrowthState(userSubs.length);
      const badgeThisWeek = !!s && isPunctualSubmission(s);
      const status = s ? `<span class="tag green">제출${badgeThisWeek ? ' ⏰' : ''}</span>` : '<span class="tag pink">미제출</span>';
      const detail = s
        ? `<div class="student-sub-detail"><img src="${safeText(s.photoURL || '')}" alt="인증샷"><div><p>${safeText(s.reflection || '')}</p><div class="helper">제출 당시 목표 v${Number(s.goalVersion || 1)} · ${safeText(s.goalSnapshot?.goalText || '목표 기록 없음')}</div><div class="helper">${safeText(formatDateTime(new Date(s.submittedAt)))} ${badgeThisWeek ? '· ⏰ 정시 배지 획득' : ''}</div></div></div>`
        : '';
      const goalBox = st.goalText
        ? `<div class="admin-goal-box"><div class="small muted">현재 행동 목표</div><div class="admin-goal-text">${safeText(st.goalText)}</div><div class="helper">${safeText(formatGoalSchedule(st))}</div><details class="goal-history-details" data-uid="${safeText(st.uid)}"><summary>목표 버전 ${st.currentGoalVersion || 1}개 · 이력 보기</summary><div class="admin-history-list" data-history-slot></div></details></div>`
        : '';
      return `<div class="student-row"><div class="student-row-top"><div class="student-identity">${characterMarkup(st.characterType || 'rabbit', userSubs.length, 'small')}<div><div class="student-name">${safeText(st.name || '이름 미입력')}</div><div class="student-id">${safeText(st.studentId || '학번 미입력')}</div></div></div><div class="student-progress"><span class="tag blue">Lv.${growth.stage}</span><span class="tag yellow">⏰ 총 ${punctualTotal}</span>${status}</div></div>${goalBox}${detail}</div>`;
    })
    .join('');
  els.studentTable.innerHTML = rows || '<div class="panel body-sm muted">등록된 학생이 없습니다.</div>';

  // Lazily fetch goal-version history only when a row's <details> is actually opened,
  // instead of pre-fetching every student's subcollection on every dashboard refresh.
  els.studentTable.querySelectorAll<HTMLDetailsElement>('.goal-history-details').forEach((detailsEl) => {
    detailsEl.addEventListener(
      'toggle',
      async () => {
        if (!detailsEl.open) return;
        const uid = detailsEl.dataset.uid!;
        const slot = detailsEl.querySelector('[data-history-slot]');
        if (!slot) return;
        slot.innerHTML = '<div class="admin-history-item muted">불러오는 중...</div>';
        const history = await backend.adminGetGoalHistory(uid);
        slot.innerHTML = goalHistoryHtml(history);
      },
      { once: true },
    );
  });
}

export function initAdminEvents() {
  els.adminWeekSelect.onchange = () => void loadAdminDashboard();
  els.adminRefreshBtn.onclick = () => void loadAdminDashboard();
  els.adminExportBtn.onclick = () => void exportExcel();
}

async function exportExcel() {
  els.adminExportBtn.disabled = true;
  const originalText = els.adminExportBtn.textContent;
  els.adminExportBtn.textContent = '내보내는 중...';
  try {
    const [students, allSubs] = await Promise.all([backend.adminListStudents(), backend.adminListAllSubmissions()]);
    await downloadSemesterExcel(students, allSubs);
    toast('Excel 파일을 내려받았습니다.', 'success');
  } catch (err) {
    console.error(err);
    toast('Excel 내보내기에 실패했습니다.', 'error');
  } finally {
    els.adminExportBtn.disabled = false;
    els.adminExportBtn.textContent = originalText;
  }
}
