import type { CharacterType, FeedPost, GoalSettings, GoalVersion, ProfileHistoryEntry, Submission, UserProfile } from '../types';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface OnboardingInput {
  name: string;
  studentId: string;
  characterType: CharacterType;
  goal: GoalSettings;
}

export interface DeleteStudentResult {
  uid: string;
  name: string;
  studentId: string;
  deletedWeeks: number[];
}

export interface SubmitWeekInput {
  week: number;
  photoBlob: Blob;
  reflection: string;
  /** Prototype-mode only: lets the tester force the punctual badge for UI testing. Ignored by the Firebase backend in production. */
  prototypePunctualOverride?: boolean;
}

/**
 * Data-access boundary between the UI and whatever actually stores the data.
 * `FirebaseBackend` is the real, authoritative implementation (Auth +
 * Firestore + Storage). `LocalBackend` is an IndexedDB-backed stand-in used
 * only in prototype/demo mode so the app can be fully click-tested before a
 * real Firebase project exists — it is never used in production and never
 * shares storage with the real backend.
 */
export interface Backend {
  readonly kind: 'firebase' | 'local';

  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
  signInGoogle(): Promise<void>;
  signInEmail(email: string, password: string): Promise<void>;
  signUpEmail(email: string, password: string): Promise<void>;
  signOutUser(): Promise<void>;
  /** Prototype-mode only (LocalBackend). Not implemented by FirebaseBackend. */
  signInDemo?(role: 'student' | 'instructor'): Promise<void>;
  resetDemoData?(): Promise<void>;

  getProfile(uid: string): Promise<UserProfile | null>;
  completeOnboarding(uid: string, email: string, input: OnboardingInput): Promise<UserProfile>;
  updateGoal(uid: string, next: GoalSettings): Promise<UserProfile>;
  getGoalHistory(uid: string): Promise<GoalVersion[]>;
  /** Corrects a typo'd name/studentId after signup. Never changes characterType (permanent) or goal fields. */
  updateProfile(uid: string, next: { name: string; studentId: string }): Promise<UserProfile>;
  getProfileHistory(uid: string): Promise<ProfileHistoryEntry[]>;

  isInstructor(email: string | null): Promise<boolean>;
  ensureInstructorProfile(uid: string, email: string, displayName: string | null): Promise<UserProfile>;

  getMySubmissions(uid: string): Promise<Submission[]>;
  submitWeek(uid: string, profile: UserProfile, input: SubmitWeekInput): Promise<Submission>;

  listFeed(weekFilter: number): Promise<FeedPost[]>;

  /** Defaults to the current semester (constants.ts SEMESTER_ID). A past semesterId can be passed once a semester-switcher UI exists — see the redesign backlog. */
  adminListStudents(semesterId?: string): Promise<UserProfile[]>;
  adminListAllSubmissions(semesterId?: string): Promise<Submission[]>;
  adminGetGoalHistory(uid: string): Promise<GoalVersion[]>;
  adminGetProfileHistory(uid: string): Promise<ProfileHistoryEntry[]>;
  /**
   * Instructor-only. Permanently deletes a student's Auth account and every
   * piece of data tied to their uid (see functions/src/index.ts for the
   * full list). Never trust the caller's role client-side — the real
   * FirebaseBackend implementation always goes through a privileged Cloud
   * Function that re-derives instructor status and target protection from
   * Firestore itself.
   */
  adminDeleteStudent(targetUid: string): Promise<DeleteStudentResult>;
}
