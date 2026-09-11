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

export type PrivacyConsentSource = 'signup' | 'existing-user';

export interface PrivacyConsentRecord {
  agreed: boolean;
  /** The PRIVACY_POLICY_VERSION (see config/privacy.ts) the student agreed to. */
  version: string;
  /** ISO string, denormalized from the Firestore server timestamp once read back — never client-supplied (see firestore.rules). */
  agreedAt: string;
  source: PrivacyConsentSource;
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

  /** Null when the student has never recorded consent (brand-new account, or an account created before this feature existed). */
  getPrivacyConsent(uid: string): Promise<PrivacyConsentRecord | null>;
  /** Records agreement to the CURRENT PRIVACY_POLICY_VERSION (config/privacy.ts) for the signed-in student. agreedAt is always a Firestore server timestamp, never client-supplied. */
  recordPrivacyConsent(uid: string, source: PrivacyConsentSource): Promise<PrivacyConsentRecord>;
  /** Instructor-facing read of a student's consent status (student-history modal). Never writes on the student's behalf. */
  adminGetPrivacyConsent(uid: string): Promise<PrivacyConsentRecord | null>;

  getMySubmissions(uid: string): Promise<Submission[]>;
  submitWeek(uid: string, profile: UserProfile, input: SubmitWeekInput): Promise<Submission>;

  /** maxResults caps how many posts are fetched (e.g. the home screen's "recent 3" widget) — omit for the Feed tab's normal page size. */
  listFeed(weekFilter: number, maxResults?: number): Promise<FeedPost[]>;
  /** Resolves only anonymous feed photos, keyed by private submission id. Never falls back to originals. */
  getFeedPhotoURLs(submissionIds: string[]): Promise<Record<string, string>>;

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
