import { PROTOTYPE_MODE, isFirebaseConfigValid } from '../config';
import { PRIVACY_POLICY_VERSION } from '../config/privacy';
import { backend } from '../backend';
import { isValidCharacterType, isValidGoalSettings, isValidName, isValidStudentId } from '../utils/validation';
import { needsPrivacyConsent } from '../utils/privacyConsent';
import { authErrorMessage } from '../utils/authErrors';
import type { CharacterType, GoalSettings } from '../types';
import { els, showScreen, setTab, toast, type TabName } from './dom';
import { state } from './state';
import { renderCharacterChoices } from './character';
import { renderAll } from './refresh';
import { getActiveWeek } from './weekState';
import { openSubmission } from './modals';
import { renderHome } from './screens/home';
import { renderWeeks } from './screens/weeks';
import { showPrivacyConsentScreen } from './privacyConsent';
import type { AuthUser } from '../backend/types';

function showOnboardingStep(n: 1 | 2) {
  els.profileStep.classList.toggle('hidden', n !== 1);
  els.goalStep.classList.toggle('hidden', n !== 2);
  document.querySelectorAll<HTMLElement>('.step-dot').forEach((d) => {
    d.classList.toggle('active', Number(d.dataset.stepdot) <= n);
  });
}

function prefillOnboarding() {
  const p = state.profile;
  if (p) {
    els.profileName.value = p.name || '';
    els.profileStudentId.value = p.studentId || '';
    state.selectedCharacter = isValidCharacterType(p.characterType) ? p.characterType : state.selectedCharacter;
    state.selectedWeekday = p.weekday ?? null;
    els.goalText.value = p.goalText || '';
    els.startTime.value = p.startTime || '19:00';
    els.duration.value = String(p.duration || 60);
    document.querySelectorAll<HTMLElement>('.weekday-btn').forEach((x) => x.classList.toggle('active', Number(x.dataset.weekday) === state.selectedWeekday));
  }
  renderCharacterChoices();
  els.goalSaveBtn.textContent = state.editingGoal ? '변경사항 저장' : '15주 챌린지 시작';
  els.goalEditHistoryNote.classList.toggle('hidden', !state.editingGoal);
  els.goalBackBtn.textContent = state.editingGoal ? '취소' : '이전';
}

// Exported so ui/privacyConsent.ts can re-run routing itself once a student
// actually agrees, instead of this module polling/awaiting a promise that
// would otherwise dangle forever if the student logs out from the consent
// screen without ever agreeing.
export async function afterLogin() {
  const user = state.currentUser;
  if (!user) return;

  const instructor = await backend.isInstructor(user.email);
  if (instructor) {
    state.profile = await backend.ensureInstructorProfile(user.uid, user.email || '', user.displayName);
    state.submissions = [];
    showScreen('main');
    await renderAll();
    setTab('admin');
    return;
  }

  state.profile = await backend.getProfile(user.uid);

  // Gate BEFORE onboarding and BEFORE the main app for every student —
  // brand-new signups and pre-existing accounts created before this feature
  // existed are treated identically: no valid consent for the current
  // PRIVACY_POLICY_VERSION means the consent screen must be passed first.
  // Never auto-agree just because the account already has other data (see
  // task requirement) — this check runs regardless of state.profile.
  const consent = await backend.getPrivacyConsent(user.uid);
  if (needsPrivacyConsent(consent, PRIVACY_POLICY_VERSION)) {
    showPrivacyConsentScreen(state.profile ? 'existing-user' : 'signup');
    return; // ui/privacyConsent.ts calls afterLogin() again once the student actually agrees
  }

  if (!state.profile) {
    state.editingGoal = false;
    showScreen('onboarding');
    showOnboardingStep(1);
    prefillOnboarding();
    return;
  }

  state.submissions = await backend.getMySubmissions(user.uid);
  showScreen('main');
  await renderAll();
  setTab('home');
}

async function handleAuthChange(user: AuthUser | null) {
  if (user) {
    state.currentUser = user;
    try {
      await afterLogin();
    } catch (err) {
      console.error(err);
      toast('로그인 처리 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.', 'error');
    }
  } else {
    state.currentUser = null;
    state.profile = null;
    state.submissions = [];
    showScreen('auth');
  }
}

async function doLogout() {
  els.studentTable.innerHTML = '';
  els.adminTotal.textContent = '0';
  els.adminSubmitted.textContent = '0';
  els.adminMissing.textContent = '0';
  els.adminPunctual.textContent = '0';
  await backend.signOutUser();
}

function readGoalFormInput(): GoalSettings {
  return {
    goalText: els.goalText.value.trim(),
    weekday: state.selectedWeekday ?? -1,
    startTime: els.startTime.value,
    duration: Number(els.duration.value),
  };
}

async function handleGoalSave() {
  const name = els.profileName.value.trim();
  const studentId = els.profileStudentId.value.trim();
  const goal = readGoalFormInput();

  if (!isValidName(name)) return toast('이름을 정확히 입력해주세요.', 'error');
  if (!isValidStudentId(studentId)) return toast('학번은 반드시 7자리 숫자여야 합니다.', 'error');
  if (!state.selectedCharacter || !isValidCharacterType(state.selectedCharacter)) return toast('성장 캐릭터를 하나 선택해주세요.', 'error');
  if (!isValidGoalSettings(goal)) {
    if (goal.weekday === -1) return toast('매주 실천할 요일을 하나 선택해주세요.', 'error');
    if (goal.duration > 120) return toast('실천 시간은 최대 2시간까지 선택할 수 있습니다.', 'error');
    return toast('행동 목표를 조금 더 구체적으로 작성해주세요. (10자 이상)', 'error');
  }

  const user = state.currentUser;
  if (!user) return;

  els.goalSaveBtn.disabled = true;
  try {
    if (state.editingGoal) {
      const before = state.profile?.currentGoalVersion ?? 1;
      state.profile = await backend.updateGoal(user.uid, goal);
      const changed = state.profile.currentGoalVersion > before;
      showScreen('main');
      await renderAll();
      setTab('home');
      state.editingGoal = false;
      toast(
        changed ? `목표가 v${state.profile.currentGoalVersion}로 수정되었습니다. 이전 목표도 이력에 보존됩니다.` : '변경된 내용이 없어 기존 목표를 그대로 유지했습니다.',
        changed ? 'success' : 'info',
      );
    } else {
      state.profile = await backend.completeOnboarding(user.uid, user.email || '', {
        name,
        studentId,
        characterType: state.selectedCharacter as CharacterType,
        goal,
      });
      state.submissions = await backend.getMySubmissions(user.uid);
      showScreen('main');
      await renderAll();
      setTab('home');
      toast('15주 챌린지가 설정되었습니다!', 'success');
    }
  } catch (err) {
    console.error(err);
    toast(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.', 'error');
  } finally {
    els.goalSaveBtn.disabled = false;
  }
}

export function initAuthEvents() {
  if (PROTOTYPE_MODE) {
    els.prototypeEntry.classList.remove('hidden');
    els.demoRoleRow.classList.remove('hidden');
    els.demoLoginBtn.onclick = () => void backend.signInDemo?.('student');
    els.demoInstructorBtn.onclick = () => void backend.signInDemo?.('instructor');
    els.demoResetBtn.onclick = async () => {
      await backend.resetDemoData?.();
      await backend.signOutUser();
      els.demoClickStatus.textContent = '체험 기록이 초기화되었습니다. 학생 화면 체험을 누르면 처음부터 시작합니다.';
      toast('체험 기록을 초기화했습니다.', 'success');
    };
  } else if (!isFirebaseConfigValid()) {
    els.backendWarning.classList.remove('hidden');
  }

  els.authSwitchBtn.onclick = () => {
    state.authMode = state.authMode === 'login' ? 'signup' : 'login';
    els.emailAuthBtn.textContent = state.authMode === 'login' ? '로그인' : '회원가입';
    els.authSwitchCopy.textContent = state.authMode === 'login' ? '계정이 없나요?' : '이미 계정이 있나요?';
    els.authSwitchBtn.textContent = state.authMode === 'login' ? '회원가입' : '로그인';
  };

  els.emailAuthBtn.onclick = async () => {
    const email = els.authEmail.value.trim();
    const pw = els.authPassword.value;
    if (!email || pw.length < 6) return toast('이메일과 6자 이상의 비밀번호를 입력해주세요.', 'error');
    const mode = state.authMode;
    try {
      if (mode === 'signup') await backend.signUpEmail(email, pw);
      else await backend.signInEmail(email, pw);
    } catch (e) {
      console.error(e);
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined;
      toast(authErrorMessage(mode, code), 'error');
    }
  };

  els.googleLoginBtn.onclick = async () => {
    try {
      await backend.signInGoogle();
    } catch (e) {
      console.error(e);
      toast('Google 로그인에 실패했습니다.', 'error');
    }
  };

  els.profileStudentId.oninput = () => {
    els.profileStudentId.value = els.profileStudentId.value.replace(/\D/g, '').slice(0, 7);
  };
  els.profileNextBtn.onclick = () => {
    const name = els.profileName.value.trim();
    const sid = els.profileStudentId.value.trim();
    if (!isValidName(name)) return toast('이름을 정확히 입력해주세요.', 'error');
    if (!isValidStudentId(sid)) return toast('학번은 반드시 7자리 숫자로 입력해주세요.', 'error');
    if (!state.selectedCharacter || !isValidCharacterType(state.selectedCharacter)) return toast('15주 동안 함께할 캐릭터를 하나 선택해주세요.', 'error');
    showOnboardingStep(2);
  };
  els.goalBackBtn.onclick = () => {
    // Editing an existing goal must never route back through the first-time
    // signup screen (name/studentId/character) — that screen is onboarding-
    // only, its fields aren't saved from here, and landing on it again after
    // already having a profile is confusing (see the redesign feedback).
    if (state.editingGoal) {
      state.editingGoal = false;
      showScreen('main');
      setTab('profile');
      return;
    }
    showOnboardingStep(1);
  };
  els.goalSaveBtn.onclick = () => void handleGoalSave();

  els.editGoalBtn.onclick = () => {
    state.editingGoal = true;
    showScreen('onboarding');
    showOnboardingStep(2);
    prefillOnboarding();
  };

  els.logoutBtn.onclick = () => void doLogout();
  els.onboardingLogout.onclick = () => void doLogout();

  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
    b.onclick = () => setTab(b.dataset.tab as TabName);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) => {
    b.onclick = () => setTab(b.dataset.goto as TabName);
  });
  els.homeSubmitBtn.onclick = () => openSubmission(getActiveWeek());
  els.testWeekSelect.onchange = () => {
    state.prototypeWeek = Number(els.testWeekSelect.value || 1);
    renderHome();
    renderWeeks();
    toast(`${state.prototypeWeek}주차 테스트 화면으로 이동했습니다.`, 'info');
  };

  backend.onAuthChange((user) => void handleAuthChange(user));
}
