import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, httpsCallable, connectFunctionsEmulator, type Functions } from 'firebase/functions';

import { firebaseConfig } from '../config';
import { PRIVACY_POLICY_VERSION } from '../config/privacy';
import { CHARACTER_TYPES, SEMESTER_ID, TOTAL_WEEKS } from '../constants';
import { getScheduledWindow, isWithinSubmissionWindow } from '../utils/date';
import { makeAnonName } from '../utils/text';
import { goalSettingsChanged } from '../utils/goal';
import { isValidGoalSettings, isValidName, isValidStudentId } from '../utils/validation';
import type { FeedPost, GoalSettings, GoalVersion, ProfileHistoryEntry, Submission, UserProfile } from '../types';
import type { Backend, AuthUser, DeleteStudentResult, OnboardingInput, PrivacyConsentRecord, PrivacyConsentSource, SubmitWeekInput } from './types';

export class SubmissionExistsError extends Error {
  constructor(week: number) {
    super(`${week}주차는 이미 제출되었습니다.`);
    this.name = 'SubmissionExistsError';
  }
}

export class OutsideWindowError extends Error {
  constructor(week: number) {
    super(`${week}주차는 지금 제출할 수 있는 기간이 아닙니다.`);
    this.name = 'OutsideWindowError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Calls the publishFeedPost Cloud Function (via the injected delegate) with
 * up to `attempts` tries, and NEVER throws. A permanently failing feed
 * publish must never surface as a submission failure to the student — the
 * private submission (see submitWeek() step 2) already committed — or crash
 * the app; it only leaves a console warning behind, with no feed post
 * created. Exported as a standalone function (not a private method) so this
 * retry/never-throw behavior can be unit-tested with a fake delegate,
 * independent of the real Firebase Functions SDK.
 */
export async function publishFeedWithRetry(callPublishFeedPost: (week: number) => Promise<unknown>, week: number, attempts = 3): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await callPublishFeedPost(week);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  console.warn(`[feed] publishFeedPost failed after ${attempts} attempts (submission itself already succeeded, week ${week}):`, lastError);
}

export interface FirebaseBackendOptions {
  /**
   * Connects to the local Firebase Emulator Suite instead of a real project.
   * Used ONLY by the integration test suite (tests/integration) — never set
   * by the app itself (backend/index.ts always constructs a plain
   * `new FirebaseBackend()` against the real project from .env). Lets tests
   * exercise the real submitWeek()/idempotency/query logic against the same
   * firestore.rules/storage.rules the production app is bound by, instead of
   * re-testing only the rules in isolation.
   */
  useEmulator?: boolean;
}

export class FirebaseBackend implements Backend {
  readonly kind = 'firebase' as const;
  private app: FirebaseApp;
  private auth: Auth;
  private db: Firestore;
  private storage: FirebaseStorage;
  private functions: Functions;

  constructor(options: FirebaseBackendOptions = {}) {
    if (options.useEmulator) {
      // Deliberately NOT firebaseConfig/.env here: the emulator doesn't
      // authenticate against a real project, but every connected service
      // (auth/firestore/storage) must agree on the same projectId — and it
      // must match the --project flag "rules:test" passes to
      // `firebase emulators:exec` (see tests/rules for the same requirement).
      // Each instance also gets a unique Firebase app name so a test process
      // can construct many FirebaseBackend instances (one per simulated user)
      // without "app already exists" collisions.
      this.app = initializeApp(
        {
          apiKey: 'demo-api-key',
          projectId: 'demo-learning-challenge',
          appId: '1:demo:web:demo',
          storageBucket: 'demo-learning-challenge.appspot.com',
        },
        `emulator-${Date.now()}-${Math.random()}`,
      );
      this.auth = getAuth(this.app);
      // No IndexedDB in the Node test runner, and no need for offline
      // persistence in a short-lived test process — plain in-memory cache.
      this.db = initializeFirestore(this.app, {});
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
      this.storage = getStorage(this.app);
      connectStorageEmulator(this.storage, '127.0.0.1', 9199);
      this.functions = getFunctions(this.app);
      connectFunctionsEmulator(this.functions, '127.0.0.1', 5001);
      return;
    }

    this.app = initializeApp(firebaseConfig);
    this.auth = getAuth(this.app);

    // Persistent local cache lets a student re-open the app offline and still
    // see their own previously-loaded profile/submissions, and queues writes
    // made while offline until connectivity returns (Firestore handles the
    // retry). Photo uploads to Storage are NOT covered by this cache — see
    // submitWeek(), which never writes the Firestore submission doc unless
    // the photo upload already succeeded.
    this.db = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    this.storage = getStorage(this.app);
    this.functions = getFunctions(this.app);
  }

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(this.auth, (u) => {
      cb(u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null);
    });
  }

  async signInGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(this.auth, provider);
    } catch {
      await signInWithRedirect(this.auth, provider);
    }
  }

  async signInEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async signUpEmail(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email, password);
  }

  async signOutUser(): Promise<void> {
    await signOut(this.auth);
  }

  async getProfile(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(this.db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  }

  async isInstructor(email: string | null): Promise<boolean> {
    if (!email) return false;
    const snap = await getDoc(doc(this.db, 'instructorAllowlist', email.toLowerCase()));
    return snap.exists();
  }

  async ensureInstructorProfile(uid: string, email: string, displayName: string | null): Promise<UserProfile> {
    const existing = await this.getProfile(uid);
    if (existing && existing.role === 'instructor') return existing;
    const stamp = nowIso();
    const data: UserProfile = {
      uid,
      name: existing?.name || displayName || '교수자',
      studentId: existing?.studentId || '',
      email,
      characterType: existing?.characterType || 'rabbit',
      anonName: existing?.anonName || makeAnonName(uid),
      role: 'instructor',
      semesterId: SEMESTER_ID,
      currentGoalVersion: 1,
      goalText: '교수자 계정은 개인 행동목표를 설정하지 않습니다.',
      weekday: 1,
      startTime: '09:00',
      duration: 30,
      goalCreatedAt: existing?.goalCreatedAt || stamp,
      updatedAt: stamp,
      createdAt: existing?.createdAt || stamp,
    };
    await setDoc(doc(this.db, 'users', uid), data);
    return data;
  }

  async completeOnboarding(uid: string, email: string, input: OnboardingInput): Promise<UserProfile> {
    if (!isValidName(input.name)) throw new Error('이름을 정확히 입력해주세요.');
    if (!isValidStudentId(input.studentId)) throw new Error('학번은 반드시 7자리 숫자여야 합니다.');
    if (!(input.characterType in CHARACTER_TYPES)) throw new Error('캐릭터를 선택해주세요.');
    if (!isValidGoalSettings(input.goal)) throw new Error('행동 목표를 다시 확인해주세요.');

    const stamp = nowIso();
    const profile: UserProfile = {
      uid,
      name: input.name.trim(),
      studentId: input.studentId,
      email,
      characterType: input.characterType,
      anonName: makeAnonName(uid),
      role: 'student',
      semesterId: SEMESTER_ID,
      currentGoalVersion: 1,
      goalText: input.goal.goalText.trim(),
      weekday: input.goal.weekday,
      startTime: input.goal.startTime,
      duration: input.goal.duration,
      goalCreatedAt: stamp,
      updatedAt: stamp,
      createdAt: stamp,
    };

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'users', uid), profile);
    batch.set(doc(this.db, 'users', uid, 'goalVersions', '1'), {
      version: 1,
      goalText: profile.goalText,
      weekday: profile.weekday,
      startTime: profile.startTime,
      duration: profile.duration,
      changedAt: serverTimestamp(),
      changeType: 'initial',
    });
    // Claims this student id for this semester (see firestore.rules
    // studentIdRegistry) — if another student already claimed it, this
    // create is evaluated as an update (no allow-update rule exists for
    // this collection) and is denied, which atomically fails the WHOLE
    // batch, so onboarding never partially completes on a duplicate id.
    batch.set(doc(this.db, 'studentIdRegistry', `${SEMESTER_ID}_${profile.studentId}`), {
      uid,
      studentId: profile.studentId,
      semesterId: SEMESTER_ID,
    });
    try {
      await batch.commit();
    } catch (err) {
      throw new Error('가입에 실패했습니다. 학번이 이미 사용 중일 수 있습니다. 학번을 다시 확인해주세요.');
    }
    return profile;
  }

  /**
   * Corrects a student's own name/studentId after signup (typos happen).
   * Never touches characterType (permanent, see firestore.rules) or goal
   * fields, and never rewrites any already-submitted week's own goalSnapshot
   * — those stay exactly as they were at submission time regardless of a
   * later profile correction.
   */
  async updateProfile(uid: string, next: { name: string; studentId: string }): Promise<UserProfile> {
    if (!isValidName(next.name)) throw new Error('이름을 정확히 입력해주세요.');
    if (!isValidStudentId(next.studentId)) throw new Error('학번은 반드시 7자리 숫자여야 합니다.');
    const current = await this.getProfile(uid);
    if (!current) throw new Error('프로필을 먼저 설정해주세요.');

    const trimmedName = next.name.trim();
    const nameChanged = trimmedName !== current.name;
    const studentIdChanged = next.studentId !== current.studentId;
    if (!nameChanged && !studentIdChanged) return current;

    const updated: UserProfile = { ...current, name: trimmedName, studentId: next.studentId, updatedAt: nowIso() };
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'users', uid), updated);
    batch.set(doc(collection(this.db, 'users', uid, 'profileHistory')), {
      previousName: current.name,
      newName: updated.name,
      previousStudentId: current.studentId,
      newStudentId: updated.studentId,
      changedAt: serverTimestamp(),
    });
    if (studentIdChanged) {
      batch.set(doc(this.db, 'studentIdRegistry', `${SEMESTER_ID}_${next.studentId}`), {
        uid,
        studentId: next.studentId,
        semesterId: SEMESTER_ID,
      });
    }
    try {
      await batch.commit();
    } catch (err) {
      throw new Error(studentIdChanged ? '학번이 이미 사용 중일 수 있습니다. 학번을 다시 확인해주세요.' : '프로필 저장에 실패했습니다.');
    }
    return updated;
  }

  async getProfileHistory(uid: string): Promise<ProfileHistoryEntry[]> {
    const qs = await getDocs(collection(this.db, 'users', uid, 'profileHistory'));
    return qs.docs
      .map((d) => d.data() as { previousName: string; newName: string; previousStudentId: string; newStudentId: string; changedAt: { toDate(): Date } })
      .map((d) => ({
        previousName: d.previousName,
        newName: d.newName,
        previousStudentId: d.previousStudentId,
        newStudentId: d.newStudentId,
        changedAt: d.changedAt?.toDate ? d.changedAt.toDate().toISOString() : nowIso(),
      }))
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt));
  }

  async updateGoal(uid: string, next: GoalSettings): Promise<UserProfile> {
    if (!isValidGoalSettings(next)) throw new Error('행동 목표를 다시 확인해주세요.');
    const current = await this.getProfile(uid);
    if (!current) throw new Error('프로필을 먼저 설정해주세요.');

    if (!goalSettingsChanged(current, next)) return current; // no-op: nothing to version

    const nextVersion = current.currentGoalVersion + 1;
    const stamp = nowIso();
    const updated: UserProfile = {
      ...current,
      goalText: next.goalText.trim(),
      weekday: next.weekday,
      startTime: next.startTime,
      duration: next.duration,
      currentGoalVersion: nextVersion,
      updatedAt: stamp,
    };

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'users', uid), updated);
    batch.set(doc(this.db, 'users', uid, 'goalVersions', String(nextVersion)), {
      version: nextVersion,
      goalText: updated.goalText,
      weekday: updated.weekday,
      startTime: updated.startTime,
      duration: updated.duration,
      changedAt: serverTimestamp(),
      changeType: 'edit',
    });
    await batch.commit();
    return updated;
  }

  async getGoalHistory(uid: string): Promise<GoalVersion[]> {
    const qs = await getDocs(collection(this.db, 'users', uid, 'goalVersions'));
    return qs.docs
      .map((d) => d.data() as { version: number; goalText: string; weekday: number; startTime: string; duration: number; changedAt: { toDate(): Date }; changeType: 'initial' | 'edit' })
      .map((d) => ({
        version: d.version,
        goalText: d.goalText,
        weekday: d.weekday,
        startTime: d.startTime,
        duration: d.duration,
        changeType: d.changeType,
        changedAt: d.changedAt?.toDate ? d.changedAt.toDate().toISOString() : nowIso(),
      }))
      .sort((a, b) => a.version - b.version);
  }

  async adminGetGoalHistory(uid: string): Promise<GoalVersion[]> {
    return this.getGoalHistory(uid);
  }

  async getPrivacyConsent(uid: string): Promise<PrivacyConsentRecord | null> {
    const snap = await getDoc(doc(this.db, 'users', uid, 'privacyConsent', 'record'));
    if (!snap.exists()) return null;
    const d = snap.data() as { agreed: boolean; version: string; agreedAt: { toDate(): Date } | null; source: PrivacyConsentSource };
    return {
      agreed: d.agreed,
      version: d.version,
      agreedAt: d.agreedAt?.toDate ? d.agreedAt.toDate().toISOString() : nowIso(),
      source: d.source,
    };
  }

  async recordPrivacyConsent(uid: string, source: PrivacyConsentSource): Promise<PrivacyConsentRecord> {
    await setDoc(doc(this.db, 'users', uid, 'privacyConsent', 'record'), {
      agreed: true,
      version: PRIVACY_POLICY_VERSION,
      agreedAt: serverTimestamp(),
      source,
    });
    return { agreed: true, version: PRIVACY_POLICY_VERSION, agreedAt: nowIso(), source };
  }

  async adminGetPrivacyConsent(uid: string): Promise<PrivacyConsentRecord | null> {
    return this.getPrivacyConsent(uid);
  }

  async adminGetProfileHistory(uid: string): Promise<ProfileHistoryEntry[]> {
    return this.getProfileHistory(uid);
  }

  async getMySubmissions(uid: string): Promise<Submission[]> {
    // Scoped to the current semester on purpose: if the same account is ever
    // reused in a later semester, a prior semester's completed weeks must
    // never count toward "this semester's" progress/growth/streak — see
    // constants.ts SEMESTER_ID.
    //
    // Deliberately NOT a where(userId==uid) query: Firestore evaluates a
    // `list` security rule once for the whole query, without per-document
    // access to `resource.data` — so a rule like
    // "allow list if resource.data.userId == request.auth.uid" cannot
    // actually be expressed for a top-level collection query the way it can
    // for a single get(). The rules instead only allow `list` on
    // `submissions` to instructors, and a student fetches their own 15
    // (at most) submission docs directly by their fully deterministic ids,
    // each individually authorized by the existing `allow get` rule
    // (owner or instructor). Same Firestore read cost either way — a get()
    // on a document that doesn't exist is billed the same as one that does.
    const ids = Array.from({ length: TOTAL_WEEKS }, (_, i) => `${uid}_${SEMESTER_ID}_w${i + 1}`);
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(this.db, 'submissions', id))));
    return snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }) as Submission);
  }

  async adminListStudents(semesterId: string = SEMESTER_ID): Promise<UserProfile[]> {
    const q = query(collection(this.db, 'users'), where('role', '==', 'student'), where('semesterId', '==', semesterId));
    const qs = await getDocs(q);
    return qs.docs.map((d) => d.data() as UserProfile);
  }

  async adminListAllSubmissions(semesterId: string = SEMESTER_ID): Promise<Submission[]> {
    const q = query(collection(this.db, 'submissions'), where('semesterId', '==', semesterId));
    const qs = await getDocs(q);
    return qs.docs.map((d) => ({ id: d.id, ...d.data() }) as Submission);
  }

  // Deliberately NOT implemented with client-side Firestore/Storage/Auth
  // calls: firestore.rules makes submissions/goalVersions/profileHistory/
  // feedPosts permanently un-deletable from any client (instructor
  // included), and no client may ever delete another user's Auth account.
  // This calls a privileged Cloud Function (Admin SDK) that re-derives the
  // caller's instructor status and the target's protected status from
  // Firestore itself — see functions/src/index.ts.
  async adminDeleteStudent(targetUid: string): Promise<DeleteStudentResult> {
    const callable = httpsCallable<{ targetUid: string }, DeleteStudentResult>(this.functions, 'deleteStudentAccount');
    const res = await callable({ targetUid });
    return res.data;
  }

  /**
   * Test/advanced use only — not part of the `Backend` interface. Calls the
   * publishFeedPost Cloud Function directly, once, with no retry, so
   * integration tests can exercise the function's own auth/ownership/
   * idempotency guarantees in isolation. submitWeek() never calls this
   * directly; it goes through publishFeedWithRetry() instead, which wraps
   * the same callable with the bounded retry that must never surface a
   * failure back to the student.
   */
  async callPublishFeedPost(week: number): Promise<{ feedId: string; photoURL: string }> {
    const callable = httpsCallable<{ week: number }, { feedId: string; photoURL: string }>(this.functions, 'publishFeedPost');
    const res = await callable({ week });
    return res.data;
  }

  // maxResults lets a caller ask for a small slice (e.g. the home screen's
  // "recent 3" widget) without first fetching the same up-to-200-document
  // page the full Feed tab needs — see ui/screens/feed.ts loadHomeRecentFeed().
  async listFeed(weekFilter: number, maxResults?: number): Promise<FeedPost[]> {
    const base = collection(this.db, 'feedPosts');
    const resultLimit = maxResults ?? (weekFilter ? 200 : 100);
    const q = weekFilter
      ? query(base, where('semesterId', '==', SEMESTER_ID), where('week', '==', weekFilter), orderBy('createdAt', 'desc'), limit(resultLimit))
      : query(base, where('semesterId', '==', SEMESTER_ID), orderBy('createdAt', 'desc'), limit(resultLimit));
    const qs = await getDocs(q);
    return qs.docs.map((d) => ({ id: d.id, ...d.data() }) as FeedPost);
  }

  async submitWeek(uid: string, profile: UserProfile, input: SubmitWeekInput): Promise<Submission> {
    const { week, photoBlob, reflection } = input;
    if (!isWithinSubmissionWindow(week)) throw new OutsideWindowError(week);

    // Both the doc id and the storage path are namespaced by semester so that
    // if the same account is ever reused in a later semester (see
    // constants.ts SEMESTER_ID), a new week-1 submission can never collide
    // with — or silently overwrite the Storage photo for — a past semester's
    // week-1 submission under the same uid.
    const subId = `${uid}_${SEMESTER_ID}_w${week}`;
    const existing = await getDoc(doc(this.db, 'submissions', subId));
    if (existing.exists()) throw new SubmissionExistsError(week);

    // 1) Upload the private proof photo FIRST. If this fails, we stop here —
    //    no Firestore document is ever written, so there is no way to end up
    //    with a "database says submitted, but there's no photo" record.
    // The original File/Blob (camera capture or file picker) is uploaded
    // as-is — no canvas re-encode — so contentType is read from the actual
    // blob rather than assumed, since it's no longer guaranteed to be JPEG.
    const contentType = photoBlob.type || 'image/jpeg';
    const photoPath = `submissions/${uid}/${SEMESTER_ID}/week${week}.jpg`;
    const photoStorageRef = ref(this.storage, photoPath);
    await uploadBytes(photoStorageRef, photoBlob, { contentType });
    const photoURL = await getDownloadURL(photoStorageRef);

    const submittedAt = nowIso();
    const goalSnapshot = {
      version: profile.currentGoalVersion,
      goalText: profile.goalText,
      weekday: profile.weekday,
      startTime: profile.startTime,
      duration: profile.duration,
    };
    const win = getScheduledWindow(week, profile.weekday, profile.startTime, profile.duration);
    const submitDate = new Date();
    const clientPunctualClaim = submitDate >= win.start && submitDate <= win.end;

    const submissionData = {
      userId: uid,
      semesterId: SEMESTER_ID,
      week,
      goalVersion: profile.currentGoalVersion,
      goalSnapshot,
      reflection: reflection.trim(),
      photoURL,
      photoStoragePath: photoPath,
      submittedAt,
      serverCreatedAt: serverTimestamp(),
      clientPunctualClaim,
      status: 'submitted' as const,
    };

    // 2) Idempotent, race-safe write: a transaction re-checks existence
    //    server-side immediately before writing, so two near-simultaneous
    //    submit taps (double click, retried request) can never both succeed.
    await runTransaction(this.db, async (tx) => {
      const subRef = doc(this.db, 'submissions', subId);
      const snap = await tx.get(subRef);
      if (snap.exists()) throw new SubmissionExistsError(week);
      tx.set(subRef, submissionData);
    });

    // 3) Anonymous feed copy — published via the publishFeedPost Cloud
    //    Function, NOT a second client upload. The student's device already
    //    sent this photo's bytes once, in step 1; the function performs a
    //    server-side Storage copy from the private object to
    //    feedPhotos/{feedId}.jpg (feedId = sha256(subId), unchanged) instead
    //    of the device uploading the same Blob again. This cannot be
    //    combined into the same transaction as the private submission
    //    above — the function's own existence check on submissions/{subId}
    //    must see it already committed — so the feed publish is necessarily
    //    a second, later request, which is what leaves a real (if narrow)
    //    window for a private-submission-without-feed-post mismatch if that
    //    second request fails. publishFeedWithRetry() never throws and never
    //    rolls back the already-committed private submission on failure —
    //    it only logs a warning — and the function itself is idempotent
    //    (deterministic feedId), so a retry can never create a duplicate.
    const callPublishFeedPost = httpsCallable<{ week: number }, { feedId: string; photoURL: string }>(this.functions, 'publishFeedPost');
    await publishFeedWithRetry((w) => callPublishFeedPost({ week: w }), week);

    return { id: subId, ...submissionData, serverCreatedAt: submitDate } as unknown as Submission;
  }
}
