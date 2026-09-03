export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found in DOM`);
  return el as T;
};

export const els = {
  authScreen: $('auth-screen'), onboardingScreen: $('onboarding-screen'), mainScreen: $('main-screen'),
  authEmail: $<HTMLInputElement>('auth-email'), authPassword: $<HTMLInputElement>('auth-password'),
  emailAuthBtn: $('email-auth-btn'), googleLoginBtn: $('google-login-btn'),
  authSwitchBtn: $('auth-switch-btn'), authSwitchCopy: $('auth-switch-copy'), backendWarning: $('backend-warning'),
  prototypeEntry: $('prototype-entry'), demoLoginBtn: $('demo-login-btn'), demoInstructorBtn: $('demo-instructor-btn'),
  demoRoleRow: $('demo-role-row'), demoResetBtn: $('demo-reset-btn'), demoClickStatus: $('demo-click-status'),

  profileStep: $('profile-step'), goalStep: $('goal-step'),
  profileName: $<HTMLInputElement>('profile-name'), profileStudentId: $<HTMLInputElement>('profile-student-id'),
  profileNextBtn: $('profile-next-btn'), characterGrid: $('character-grid'),
  goalText: $<HTMLTextAreaElement>('goal-text'), weekdayGrid: $('weekday-grid'),
  startTime: $<HTMLSelectElement>('start-time'), duration: $<HTMLSelectElement>('duration'),
  goalSaveBtn: $<HTMLButtonElement>('goal-save-btn'), goalBackBtn: $('goal-back-btn'), goalEditHistoryNote: $('goal-edit-history-note'),
  onboardingLogout: $('onboarding-logout'), programPeriodText: $('program-period-text'),

  bottomNav: $('bottom-nav'), adminNavBtn: $('admin-nav-btn'),
  homeName: $('home-name'), homeAvatar: $('home-avatar'), homeWeekTag: $('home-week-tag'),
  homeWeekTitle: $('home-week-title'), homeGoal: $('home-goal'), homeSchedule: $('home-schedule'),
  homeDuration: $('home-duration'), homeProgressText: $('home-progress-text'), homeProgressFill: $('home-progress-fill'),
  homeSubmitBtn: $<HTMLButtonElement>('home-submit-btn'), homeSubmitHelp: $('home-submit-help'),
  metricCompleted: $('metric-completed'), metricBadges: $('metric-badges'), metricStreak: $('metric-streak'),
  homeMiniFeed: $('home-mini-feed'), prototypeBanner: $('prototype-banner'), testWeekSelect: $<HTMLSelectElement>('test-week-select'),
  growthAvatar: $('growth-avatar'), growthLevel: $('growth-level'), growthStageName: $('growth-stage-name'),
  growthBadgeCount: $('growth-badge-count'), growthCharacterName: $('growth-character-name'),
  growthXpText: $('growth-xp-text'), growthXpFill: $('growth-xp-fill'), growthNext: $('growth-next'),

  weekList: $('week-list'), feedList: $('feed-list'), feedWeekFilter: $('feed-week-filter'),

  profileAvatar: $('profile-avatar'), profileNameView: $('profile-name-view'), profileIdView: $('profile-id-view'),
  profileEmailView: $('profile-email-view'), profileAnonView: $('profile-anon-view'), profileCharacterView: $('profile-character-view'),
  profileGrowthView: $('profile-growth-view'), profileBadgeView: $('profile-badge-view'), profileGoalView: $('profile-goal-view'),
  profileScheduleView: $('profile-schedule-view'), editGoalBtn: $('edit-goal-btn'), goalHistoryBtn: $('goal-history-btn'),
  goalHistoryCount: $('goal-history-count'), logoutBtn: $('logout-btn'),

  submissionModal: $('submission-modal'), submitWeekLabel: $('submit-week-label'), submitGoalText: $('submit-goal-text'),
  prototypePunctualBox: $('prototype-punctual-box'), prototypePunctualCheck: $<HTMLInputElement>('prototype-punctual-check'),
  cameraVideo: $<HTMLVideoElement>('camera-video'), cameraPlaceholder: $('camera-placeholder'),
  capturedPreview: $<HTMLImageElement>('captured-preview'), cameraStartBtn: $('camera-start-btn'),
  cameraCaptureBtn: $<HTMLButtonElement>('camera-capture-btn'), cameraRetakeBtn: $('camera-retake-btn'),
  cameraFileInput: $<HTMLInputElement>('camera-file-input'), cameraFileBtn: $('camera-file-btn'),
  prototypePhotoBtn: $('prototype-photo-btn'), reflectionText: $<HTMLTextAreaElement>('reflection-text'),
  reflectionCount: $('reflection-count'), submitFinalBtn: $<HTMLButtonElement>('submit-final-btn'),

  detailModal: $('detail-modal'), detailWeekLabel: $('detail-week-label'), detailGoal: $('detail-goal'),
  detailGoalSchedule: $('detail-goal-schedule'), detailBadge: $('detail-badge'), detailPhoto: $<HTMLImageElement>('detail-photo'),
  detailPhotoFallback: $('detail-photo-fallback'),
  detailReflection: $('detail-reflection'), detailMeta: $('detail-meta'),
  goalHistoryModal: $('goal-history-modal'), goalHistoryList: $('goal-history-list'),

  adminWeekSelect: $<HTMLSelectElement>('admin-week-select'), adminTotal: $('admin-total'), adminSubmitted: $('admin-submitted'),
  adminMissing: $('admin-missing'), adminPunctual: $('admin-punctual'), adminWeekDate: $('admin-week-date'),
  studentTable: $('student-table'), adminRefreshBtn: $('admin-refresh-btn'), adminExportBtn: $<HTMLButtonElement>('admin-export-btn'),
  adminSearchInput: $<HTMLInputElement>('admin-search-input'), adminFilter: $('admin-filter'),

  historyModal: $('student-history-modal'), historyStudentName: $('history-student-name'),
  historySummary: $('history-summary'), historyGoalVersions: $('history-goal-versions'), historyWeeks: $('history-weeks'),

  toastWrap: $('toast-wrap'),
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, type: 'info' | 'success' | 'error' = 'info') {
  els.toastWrap.innerHTML = `<div class="toast ${type}">${escapeToastText(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toastWrap.innerHTML = ''; }, 2800);
}
function escapeToastText(s: string) {
  return s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
}

export type ScreenName = 'auth' | 'onboarding' | 'main';
export function showScreen(name: ScreenName) {
  els.authScreen.classList.toggle('hidden', name !== 'auth');
  els.onboardingScreen.classList.toggle('hidden', name !== 'onboarding');
  els.mainScreen.classList.toggle('hidden', name !== 'main');
}

export type TabName = 'home' | 'weeks' | 'feed' | 'profile' | 'admin';
let onTabChange: ((tab: TabName) => void) | null = null;
export function registerTabChangeHandler(fn: (tab: TabName) => void) {
  onTabChange = fn;
}
export function setTab(tab: TabName) {
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.add('hidden'));
  $(`tab-${tab}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
  onTabChange?.(tab);
}
