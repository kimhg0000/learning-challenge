import { formatDate, formatDateTime } from '../../utils/date';
import { getGrowthState } from '../../utils/growth';
import { isPunctualSubmission } from '../../utils/punctual';
import { safeText } from '../../utils/text';
import { imgWithFallback } from '../../utils/imgFallback';
import { formatGoalSchedule } from '../../utils/goal';
import { computeStudentWeekRows } from '../../utils/studentHistory';
import { downloadSemesterExcel } from '../../admin/excelExport';
import { backend } from '../../backend';
import { TOTAL_WEEKS } from '../../constants';
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

// Every student + every submission for the whole semester, cached for the
// lifetime of this admin session. Switching the week dropdown, or the
// refresh-on-tab-activation that used to happen on every visit to the
// 관리 tab, re-reads all ~1,500 submission documents from Firestore for no
// reason — the same two full-collection reads regardless of which single
// week the instructor actually wants to look at. Only an explicit
// "새로고침" click (or the very first load) re-fetches; switching weeks
// just re-renders the already-loaded data.
let dashboardCache: { students: UserProfile[]; allSubs: Submission[] } | null = null;
let searchQuery = '';
type StatusFilter = 'all' | 'submitted' | 'missing' | 'punctual';
let statusFilter: StatusFilter = 'all';

export async function loadAdminDashboard(options: { forceRefresh?: boolean } = {}) {
  const week = Number(els.adminWeekSelect.value || 1) || 1;
  els.adminWeekSelect.value = String(week);
  const { start, end } = getWeekBounds(week);
  els.adminWeekDate.textContent = `${formatDate(start)} 00:00 ~ ${formatDate(end)} 23:59 · 이 기간 안에는 어느 요일에 제출해도 정상 완료입니다.`;

  try {
    if (options.forceRefresh || !dashboardCache) {
      const [students, allSubs] = await Promise.all([backend.adminListStudents(), backend.adminListAllSubmissions()]);
      dashboardCache = { students, allSubs };
    }
    const { students, allSubs } = dashboardCache;
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

  const q = searchQuery.trim().toLowerCase();
  const rows = [...students]
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
    .map((st) => {
      const userSubs = allSubs.filter((x) => x.userId === st.uid);
      const s = byUid.get(st.uid);
      const badgeThisWeek = !!s && isPunctualSubmission(s);
      return { st, userSubs, s, badgeThisWeek };
    })
    .filter(({ st }) => !q || (st.name || '').toLowerCase().includes(q) || (st.studentId || '').includes(q))
    .filter(({ s, badgeThisWeek }) => {
      if (statusFilter === 'submitted') return !!s;
      if (statusFilter === 'missing') return !s;
      if (statusFilter === 'punctual') return badgeThisWeek;
      return true;
    })
    .map(({ st, userSubs, s, badgeThisWeek }) => {
      const punctualTotal = userSubs.filter((x) => isPunctualSubmission(x)).length;
      const growth = getGrowthState(userSubs.length);
      const status = s ? `<span class="tag green">제출${badgeThisWeek ? ' ⏰' : ''}</span>` : '<span class="tag pink">미제출</span>';
      const detail = s
        ? `<div class="student-sub-detail">${imgWithFallback(s.photoURL, '인증샷', '')}<div><div class="reflection-label">성찰 및 다짐</div><p>${safeText(s.reflection || '(작성된 성찰이 없습니다)')}</p><div class="helper">제출 당시 목표 v${Number(s.goalVersion || 1)} · ${safeText(s.goalSnapshot?.goalText || '목표 기록 없음')}</div><div class="helper">${safeText(formatDateTime(new Date(s.submittedAt)))} ${badgeThisWeek ? '· ⏰ 정시 배지 획득' : ''}</div></div></div>`
        : '';
      const goalBox = st.goalText
        ? `<div class="admin-goal-box"><div class="small muted">현재 행동 목표</div><div class="admin-goal-text">${safeText(st.goalText)}</div><div class="helper">${safeText(formatGoalSchedule(st))}</div><details class="goal-history-details" data-uid="${safeText(st.uid)}"><summary>목표 버전 ${st.currentGoalVersion || 1}개 · 이력 보기</summary><div class="admin-history-list" data-history-slot></div></details></div>`
        : '';
      return `<div class="student-row"><div class="student-row-top"><div class="student-identity">${characterMarkup(st.characterType || 'rabbit', userSubs.length, 'small')}<div><div class="student-name student-name-link" data-history-uid="${safeText(st.uid)}">${safeText(st.name || '이름 미입력')}<span class="chev">›</span></div><div class="student-id">${safeText(st.studentId || '학번 미입력')}</div></div></div><div class="student-progress"><span class="tag accent">Lv.${growth.stage}</span><span class="tag yellow">⏰ 총 ${punctualTotal}</span>${status}</div></div>${goalBox}${detail}</div>`;
    })
    .join('');
  els.studentTable.innerHTML = rows || '<div class="panel body-sm muted">조건에 맞는 학생이 없습니다.</div>';

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

  els.studentTable.querySelectorAll<HTMLElement>('.student-name-link').forEach((nameEl) => {
    nameEl.onclick = () => {
      const uid = nameEl.dataset.historyUid;
      if (uid) void openStudentHistory(uid);
    };
  });
}

function historyWeekCardHtml(row: ReturnType<typeof computeStudentWeekRows>[number]): string {
  if (row.status === 'future') {
    return `<div class="history-week-item future"><div class="history-week-card"><div class="history-week-top"><b>WEEK ${row.week}</b><span class="tag">아직 시작 전</span></div></div></div>`;
  }
  if (row.status === 'missing') {
    return `<div class="history-week-item"><div class="history-week-card"><div class="history-week-top"><b>WEEK ${row.week}</b><span class="tag pink">미제출</span></div></div></div>`;
  }
  const s = row.sub!;
  const badge = isPunctualSubmission(s);
  return `<div class="history-week-item submitted"><div class="history-week-card submitted"><div class="history-week-top"><b>WEEK ${row.week}</b><span class="tag green">제출${badge ? ' · ⏰ 정시' : ''}</span></div><div class="history-week-body">${imgWithFallback(s.photoURL, `${row.week}주차 인증샷`, '')}<div><div class="reflection-label">성찰 및 다짐</div><p>${safeText(s.reflection || '(작성된 성찰이 없습니다)')}</p><div class="helper">제출 당시 목표 v${Number(s.goalVersion || 1)} · ${safeText(s.goalSnapshot?.goalText || '목표 기록 없음')}</div><div class="helper">${safeText(formatDateTime(new Date(s.submittedAt)))}</div></div></div></div></div>`;
}

async function openStudentHistory(uid: string) {
  if (!dashboardCache) return;
  const student = dashboardCache.students.find((s) => s.uid === uid);
  if (!student) return;
  const userSubs = dashboardCache.allSubs.filter((s) => s.userId === uid);
  const punctualTotal = userSubs.filter((s) => isPunctualSubmission(s)).length;
  const growth = getGrowthState(userSubs.length);

  els.historyStudentName.textContent = student.name || '이름 미입력';
  els.historySummary.innerHTML = [
    `<div class="stat"><span>학번</span><b>${safeText(student.studentId || '미입력')}</b></div>`,
    `<div class="stat"><span>캐릭터 레벨</span><b>Lv.${growth.stage} · ${safeText(growth.name)}</b></div>`,
    `<div class="stat"><span>총 제출</span><b>${userSubs.length} / ${TOTAL_WEEKS}주</b></div>`,
    `<div class="stat"><span>정시 배지</span><b>⏰ ${punctualTotal}개</b></div>`,
    `<div class="stat goal-text"><span>현재 행동 목표 (v${student.currentGoalVersion || 1})</span><b>${safeText(student.goalText || '목표 기록 없음')}</b></div>`,
  ].join('');

  els.historyGoalVersions.innerHTML = '<div class="admin-history-item muted">불러오는 중...</div>';
  els.historyWeeks.innerHTML = computeStudentWeekRows(userSubs).map(historyWeekCardHtml).join('');
  els.historyModal.classList.remove('hidden');

  const history = await backend.adminGetGoalHistory(uid);
  els.historyGoalVersions.innerHTML = goalHistoryHtml(history);
}

export function initAdminEvents() {
  els.adminWeekSelect.onchange = () => void loadAdminDashboard(); // cached — just re-renders for the newly selected week
  els.adminRefreshBtn.onclick = () => void loadAdminDashboard({ forceRefresh: true });
  els.adminExportBtn.onclick = () => void exportExcel();

  els.adminSearchInput.oninput = () => {
    searchQuery = els.adminSearchInput.value;
    void loadAdminDashboard(); // cached — search/filter never re-fetches
  };
  els.adminFilter.querySelectorAll<HTMLButtonElement>('.admin-filter-chip').forEach((chip) => {
    chip.onclick = () => {
      statusFilter = (chip.dataset.filter as StatusFilter) || 'all';
      els.adminFilter.querySelectorAll('.admin-filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
      void loadAdminDashboard();
    };
  });
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
