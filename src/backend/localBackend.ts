import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { CHARACTER_TYPES, SEMESTER_ID } from '../constants';
import { PRIVACY_POLICY_VERSION } from '../config/privacy';
import { getGrowthState } from '../utils/growth';
import { getScheduledWindow } from '../utils/date';
import { makeAnonName } from '../utils/text';
import { goalSettingsChanged } from '../utils/goal';
import { isValidGoalSettings, isValidName, isValidStudentId } from '../utils/validation';
import type { FeedPost, GoalSettings, GoalVersion, ProfileHistoryEntry, Submission, UserProfile } from '../types';
import type { AuthUser, Backend, DeleteStudentResult, OnboardingInput, PrivacyConsentRecord, PrivacyConsentSource, SubmitWeekInput } from './types';

/**
 * Prototype/demo backend. Everything here lives in this browser's IndexedDB
 * only (via idb-keyval) — it is never the real student data store, never
 * touches Firebase, and is only ever selected when VITE_PROTOTYPE_MODE=true
 * (see backend/index.ts). It exists purely so an instructor can click through
 * every screen — including the admin dashboard with a few synthetic
 * classmates — before a real Firebase project has been created.
 */
const DEMO_STUDENT_UID = 'demo-student';
const DEMO_INSTRUCTOR_UID = 'demo-instructor';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

const SYNTHETIC_STUDENTS: UserProfile[] = [
  {
    uid: 'demo-classmate-1', name: '이서준', studentId: '2345678', email: '', characterType: 'fox',
    anonName: makeAnonName('demo-classmate-1'), role: 'student', semesterId: SEMESTER_ID, currentGoalVersion: 1,
    goalText: '매주 정해진 시간에 전공 노트를 60분 복습한다.', weekday: 3, startTime: '19:00', duration: 60,
    goalCreatedAt: nowIso(), updatedAt: nowIso(), createdAt: nowIso(),
  },
  {
    uid: 'demo-classmate-2', name: '박지민', studentId: '3456789', email: '', characterType: 'otter',
    anonName: makeAnonName('demo-classmate-2'), role: 'student', semesterId: SEMESTER_ID, currentGoalVersion: 1,
    goalText: '매주 영어 논문을 90분 읽고 표현 5개를 기록한다.', weekday: 5, startTime: '16:00', duration: 90,
    goalCreatedAt: nowIso(), updatedAt: nowIso(), createdAt: nowIso(),
  },
];

const SAMPLE_PHOTO =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc4MDAnIGhlaWdodD0nNjAwJz48cmVjdCB3aWR0aD0nODAwJyBoZWlnaHQ9JzYwMCcgZmlsbD0nIzEzMWIyZScvPjxyZWN0IHg9JzgwJyB5PSc5MCcgd2lkdGg9JzY0MCcgaGVpZ2h0PSc0MjAnIHJ4PScyOCcgZmlsbD0nIzFiMjk0NCcgc3Ryb2tlPScjMDBlN2ZmJyBzdHJva2Utb3BhY2l0eT0nLjQnIHN0cm9rZS13aWR0aD0nNCcvPjx0ZXh0IHg9JzQwMCcgeT0nMjg1JyB0ZXh0LWFuY2hvcj0nbWlkZGxlJyBmaWxsPScjMDBlN2ZmJyBmb250LXNpemU9JzQyJyBmb250LWZhbWlseT0nc2Fucy1zZXJpZicgZm9udC13ZWlnaHQ9JzcwMCc+TEVBUk5JTkcgQ0hBTExFTkdFPC90ZXh0Pjx0ZXh0IHg9JzQwMCcgeT0nMzQ1JyB0ZXh0LWFuY2hvcj0nbWlkZGxlJyBmaWxsPScjZGZlN2ZhJyBmb250LXNpemU9JzI2JyBmb250LWZhbWlseT0nc2Fucy1zZXJpZic+QW5vbnltb3VzIFN0dWR5IFByb29mPC90ZXh0Pjwvc3ZnPg==";

function syntheticSubmission(uid: string, profile: UserProfile, week: number, punctual: boolean): Submission {
  const win = getScheduledWindow(week, profile.weekday, profile.startTime, profile.duration);
  const submittedDate = punctual ? win.start : new Date(win.start.getTime() + 26 * 3600000);
  return {
    id: `${uid}_${SEMESTER_ID}_w${week}`,
    userId: uid,
    semesterId: SEMESTER_ID,
    week,
    goalVersion: 1,
    goalSnapshot: { version: 1, goalText: profile.goalText, weekday: profile.weekday, startTime: profile.startTime, duration: profile.duration },
    reflection: '이번 주 목표를 계획대로 실천했다. 다음 주에도 같은 흐름을 유지하고 싶다.',
    photoURL: SAMPLE_PHOTO,
    photoStoragePath: '',
    submittedAt: submittedDate.toISOString(),
    serverCreatedAt: submittedDate,
    clientPunctualClaim: punctual,
    status: 'submitted',
  };
}

interface DemoState {
  profile: UserProfile | null;
  goalVersions: GoalVersion[];
  submissions: Submission[];
  profileHistory: ProfileHistoryEntry[];
}

async function loadState(uid: string): Promise<DemoState> {
  const raw = await idbGet<Partial<DemoState>>(`demo:state:${uid}`);
  return { profile: null, goalVersions: [], submissions: [], profileHistory: [], ...raw };
}
async function saveState(uid: string, state: DemoState): Promise<void> {
  await idbSet(`demo:state:${uid}`, state);
}

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private listeners: Array<(user: AuthUser | null) => void> = [];
  private currentUser: AuthUser | null = null;

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    this.listeners.push(cb);
    // Restore the last demo role, if any, so a page reload doesn't log the tester out.
    void idbGet<'student' | 'instructor'>('demo:lastRole').then((role) => {
      if (role && !this.currentUser) this.applyLogin(role);
      else cb(this.currentUser);
    });
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private applyLogin(role: 'student' | 'instructor') {
    this.currentUser =
      role === 'instructor'
        ? { uid: DEMO_INSTRUCTOR_UID, email: 'professor@demo.local', displayName: '교수자(체험)' }
        : { uid: DEMO_STUDENT_UID, email: 'demo@student.local', displayName: '체험 학생' };
    void idbSet('demo:lastRole', role);
    this.listeners.forEach((l) => l(this.currentUser));
  }

  async signInDemo(role: 'student' | 'instructor'): Promise<void> {
    this.applyLogin(role);
  }

  async signInGoogle(): Promise<void> {
    throw new Error('프로토타입 모드에서는 체험하기 버튼을 사용해주세요.');
  }
  async signInEmail(): Promise<void> {
    throw new Error('프로토타입 모드에서는 체험하기 버튼을 사용해주세요.');
  }
  async signUpEmail(): Promise<void> {
    throw new Error('프로토타입 모드에서는 체험하기 버튼을 사용해주세요.');
  }
  async signOutUser(): Promise<void> {
    this.currentUser = null;
    await idbDel('demo:lastRole');
    this.listeners.forEach((l) => l(null));
  }

  async resetDemoData(): Promise<void> {
    await idbDel(`demo:state:${DEMO_STUDENT_UID}`);
    await idbDel(`demo:state:${DEMO_INSTRUCTOR_UID}`);
  }

  async isInstructor(email: string | null): Promise<boolean> {
    return email === 'professor@demo.local';
  }

  async ensureInstructorProfile(uid: string, email: string): Promise<UserProfile> {
    const stamp = nowIso();
    const profile: UserProfile = {
      uid, name: '교수자(체험)', studentId: '', email, characterType: 'rabbit',
      anonName: makeAnonName(uid), role: 'instructor', semesterId: SEMESTER_ID, currentGoalVersion: 1,
      goalText: '', weekday: 1, startTime: '09:00', duration: 30,
      goalCreatedAt: stamp, updatedAt: stamp, createdAt: stamp,
    };
    const state = await loadState(uid);
    state.profile = profile;
    await saveState(uid, state);
    return profile;
  }

  async getProfile(uid: string): Promise<UserProfile | null> {
    return (await loadState(uid)).profile;
  }

  async completeOnboarding(uid: string, email: string, input: OnboardingInput): Promise<UserProfile> {
    if (!isValidName(input.name)) throw new Error('이름을 정확히 입력해주세요.');
    if (!isValidStudentId(input.studentId)) throw new Error('학번은 반드시 7자리 숫자여야 합니다.');
    if (!(input.characterType in CHARACTER_TYPES)) throw new Error('캐릭터를 선택해주세요.');
    if (!isValidGoalSettings(input.goal)) throw new Error('행동 목표를 다시 확인해주세요.');

    const stamp = nowIso();
    const profile: UserProfile = {
      uid, name: input.name.trim(), studentId: input.studentId, email, characterType: input.characterType,
      anonName: makeAnonName(uid), role: 'student', semesterId: SEMESTER_ID, currentGoalVersion: 1,
      goalText: input.goal.goalText.trim(), weekday: input.goal.weekday, startTime: input.goal.startTime, duration: input.goal.duration,
      goalCreatedAt: stamp, updatedAt: stamp, createdAt: stamp,
    };
    const state = await loadState(uid);
    state.profile = profile;
    state.goalVersions = [{ version: 1, ...input.goal, changedAt: stamp, changeType: 'initial' }];
    await saveState(uid, state);
    return profile;
  }

  async updateGoal(uid: string, next: GoalSettings): Promise<UserProfile> {
    if (!isValidGoalSettings(next)) throw new Error('행동 목표를 다시 확인해주세요.');
    const state = await loadState(uid);
    if (!state.profile) throw new Error('프로필을 먼저 설정해주세요.');
    if (!goalSettingsChanged(state.profile, next)) return state.profile;

    const nextVersion = state.profile.currentGoalVersion + 1;
    const stamp = nowIso();
    state.profile = { ...state.profile, ...next, goalText: next.goalText.trim(), currentGoalVersion: nextVersion, updatedAt: stamp };
    state.goalVersions.push({ version: nextVersion, ...next, goalText: next.goalText.trim(), changedAt: stamp, changeType: 'edit' });
    await saveState(uid, state);
    return state.profile;
  }

  async getGoalHistory(uid: string): Promise<GoalVersion[]> {
    return (await loadState(uid)).goalVersions;
  }
  async adminGetGoalHistory(uid: string): Promise<GoalVersion[]> {
    if (uid === 'demo-classmate-1' || uid === 'demo-classmate-2') return [];
    return this.getGoalHistory(uid);
  }

  // Prototype/demo mode never shows the privacy-consent screen — it has no
  // real student data to protect, and gating the click-through demo behind a
  // consent step would just add friction for the instructors clicking
  // through it pre-launch. Always report "already agreed" so the existing
  // demo flow (see ui/auth.ts afterLogin()) is completely unaffected.
  async getPrivacyConsent(): Promise<PrivacyConsentRecord | null> {
    return { agreed: true, version: PRIVACY_POLICY_VERSION, agreedAt: nowIso(), source: 'signup' };
  }
  async recordPrivacyConsent(_uid: string, source: PrivacyConsentSource): Promise<PrivacyConsentRecord> {
    return { agreed: true, version: PRIVACY_POLICY_VERSION, agreedAt: nowIso(), source };
  }
  async adminGetPrivacyConsent(): Promise<PrivacyConsentRecord | null> {
    return this.getPrivacyConsent();
  }

  async updateProfile(uid: string, next: { name: string; studentId: string }): Promise<UserProfile> {
    if (!isValidName(next.name)) throw new Error('이름을 정확히 입력해주세요.');
    if (!isValidStudentId(next.studentId)) throw new Error('학번은 반드시 7자리 숫자여야 합니다.');
    const state = await loadState(uid);
    if (!state.profile) throw new Error('프로필을 먼저 설정해주세요.');
    const trimmedName = next.name.trim();
    if (trimmedName === state.profile.name && next.studentId === state.profile.studentId) return state.profile;

    state.profileHistory.push({
      previousName: state.profile.name, newName: trimmedName,
      previousStudentId: state.profile.studentId, newStudentId: next.studentId,
      changedAt: nowIso(),
    });
    state.profile = { ...state.profile, name: trimmedName, studentId: next.studentId, updatedAt: nowIso() };
    await saveState(uid, state);
    return state.profile;
  }

  async getProfileHistory(uid: string): Promise<ProfileHistoryEntry[]> {
    return (await loadState(uid)).profileHistory;
  }
  async adminGetProfileHistory(uid: string): Promise<ProfileHistoryEntry[]> {
    if (uid === 'demo-classmate-1' || uid === 'demo-classmate-2') return [];
    return this.getProfileHistory(uid);
  }

  async getMySubmissions(uid: string): Promise<Submission[]> {
    return (await loadState(uid)).submissions;
  }

  async adminListStudents(): Promise<UserProfile[]> {
    // Prototype mode never has more than one semester's worth of local data, so
    // the semesterId parameter (used by FirebaseBackend to view an archived
    // semester) is intentionally not implemented here.
    const real = (await loadState(DEMO_STUDENT_UID)).profile;
    return [...(real ? [real] : []), ...SYNTHETIC_STUDENTS];
  }

  async adminListAllSubmissions(): Promise<Submission[]> {
    const real = (await loadState(DEMO_STUDENT_UID)).submissions;
    const synthetic = SYNTHETIC_STUDENTS.flatMap((s) => [
      syntheticSubmission(s.uid, s, 1, true),
      syntheticSubmission(s.uid, s, 2, false),
    ]);
    return [...real, ...synthetic];
  }

  // Prototype-mode stand-in: the real deletion is a privileged Cloud
  // Function that does not exist in this local, Firebase-free backend.
  // SYNTHETIC_STUDENTS is a fixed constant, not real per-instance data, so
  // it can't be meaningfully "deleted" — only the one real demo student's
  // locally-stored IndexedDB state can be.
  async adminDeleteStudent(targetUid: string): Promise<DeleteStudentResult> {
    if (targetUid !== DEMO_STUDENT_UID) {
      throw new Error('프로토타입 모드에서는 데모 동급생 계정을 삭제할 수 없습니다.');
    }
    const state = await loadState(targetUid);
    const name = state.profile?.name || '';
    const studentId = state.profile?.studentId || '';
    const deletedWeeks = state.submissions.map((s) => s.week);
    await idbDel(`demo:state:${targetUid}`);
    return { uid: targetUid, name, studentId, deletedWeeks };
  }

  async listFeed(weekFilter: number): Promise<FeedPost[]> {
    const mine = await this.getMySubmissions(DEMO_STUDENT_UID);
    const myProfile = (await loadState(DEMO_STUDENT_UID)).profile;
    const mineAsFeed: FeedPost[] = mine.map((s) => ({
      id: s.id,
      anonName: myProfile?.anonName || makeAnonName(DEMO_STUDENT_UID),
      semesterId: SEMESTER_ID,
      week: s.week,
      reflection: s.reflection,
      photoURL: s.photoURL,
      characterType: myProfile?.characterType || 'rabbit',
      characterStage: getGrowthState(mine.filter((x) => x.week <= s.week).length).stage,
      punctualClaim: s.clientPunctualClaim,
      createdAt: new Date(s.submittedAt),
    }));
    const sample: FeedPost[] = [
      { id: 'sample-1', anonName: '도전자 314', semesterId: SEMESTER_ID, week: 2, reflection: '이번 주에는 계획한 시간만큼 집중해서 읽었다. 다음 주에는 시작 10분 전에 자리를 잡아 흐름을 더 안정적으로 만들고 싶다.', photoURL: SAMPLE_PHOTO, characterType: 'fox', characterStage: 2, punctualClaim: true, createdAt: new Date('2026-09-16T19:20:00') },
      { id: 'sample-2', anonName: '도전자 628', semesterId: SEMESTER_ID, week: 1, reflection: '첫 주라 긴장했지만 계획한 행동을 끝냈다. 다음 주에는 기록까지 더 꼼꼼하게 남겨보겠다.', photoURL: SAMPLE_PHOTO, characterType: 'panda', characterStage: 1, punctualClaim: false, createdAt: new Date('2026-09-10T15:00:00') },
    ];
    return [...mineAsFeed, ...sample]
      .filter((f) => !weekFilter || f.week === weekFilter)
      .sort((a, b) => new Date(b.createdAt as Date).getTime() - new Date(a.createdAt as Date).getTime());
  }

  async submitWeek(uid: string, profile: UserProfile, input: SubmitWeekInput): Promise<Submission> {
    const state = await loadState(uid);
    if (state.submissions.some((s) => s.week === input.week)) {
      throw new Error(`${input.week}주차는 이미 제출되었습니다.`);
    }
    const photoURL = await blobToDataUrl(input.photoBlob);
    const submitDate = new Date();
    const win = getScheduledWindow(input.week, profile.weekday, profile.startTime, profile.duration);
    const punctual = input.prototypePunctualOverride ?? (submitDate >= win.start && submitDate <= win.end);

    const submission: Submission = {
      id: `${uid}_${SEMESTER_ID}_w${input.week}`,
      userId: uid,
      semesterId: SEMESTER_ID,
      week: input.week,
      goalVersion: profile.currentGoalVersion,
      goalSnapshot: { version: profile.currentGoalVersion, goalText: profile.goalText, weekday: profile.weekday, startTime: profile.startTime, duration: profile.duration },
      reflection: input.reflection.trim(),
      photoURL,
      photoStoragePath: '',
      submittedAt: submitDate.toISOString(),
      serverCreatedAt: submitDate,
      clientPunctualClaim: punctual,
      status: 'test',
    };
    state.submissions.push(submission);
    await saveState(uid, state);
    return submission;
  }
}
