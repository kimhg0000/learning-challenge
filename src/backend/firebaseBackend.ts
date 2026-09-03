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
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
import { getStorage, ref, uploadBytes, getDownloadURL, type FirebaseStorage } from 'firebase/storage';

import { firebaseConfig } from '../config';
import { CHARACTER_TYPES } from '../constants';
import { getGrowthState } from '../utils/growth';
import { getScheduledWindow, isWithinSubmissionWindow } from '../utils/date';
import { makeAnonName } from '../utils/text';
import { goalSettingsChanged } from '../utils/goal';
import { isValidGoalSettings, isValidName, isValidStudentId } from '../utils/validation';
import type { FeedPost, GoalSettings, GoalVersion, Submission, UserProfile } from '../types';
import type { Backend, AuthUser, OnboardingInput, SubmitWeekInput } from './types';

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

export class FirebaseBackend implements Backend {
  readonly kind = 'firebase' as const;
  private app: FirebaseApp;
  private auth: Auth;
  private db: Firestore;
  private storage: FirebaseStorage;

  constructor() {
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
    await batch.commit();
    return profile;
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

  async getMySubmissions(uid: string): Promise<Submission[]> {
    const q = query(collection(this.db, 'submissions'), where('userId', '==', uid));
    const qs = await getDocs(q);
    return qs.docs.map((d) => ({ id: d.id, ...d.data() }) as Submission);
  }

  async adminListStudents(): Promise<UserProfile[]> {
    const q = query(collection(this.db, 'users'), where('role', '==', 'student'));
    const qs = await getDocs(q);
    return qs.docs.map((d) => d.data() as UserProfile);
  }

  async adminListAllSubmissions(): Promise<Submission[]> {
    const qs = await getDocs(collection(this.db, 'submissions'));
    return qs.docs.map((d) => ({ id: d.id, ...d.data() }) as Submission);
  }

  async listFeed(weekFilter: number): Promise<FeedPost[]> {
    const base = collection(this.db, 'feedPosts');
    const q = weekFilter
      ? query(base, where('week', '==', weekFilter), orderBy('createdAt', 'desc'), limit(200))
      : query(base, orderBy('createdAt', 'desc'), limit(100));
    const qs = await getDocs(q);
    return qs.docs.map((d) => ({ id: d.id, ...d.data() }) as FeedPost);
  }

  async submitWeek(uid: string, profile: UserProfile, input: SubmitWeekInput): Promise<Submission> {
    const { week, photoBlob, reflection } = input;
    if (!isWithinSubmissionWindow(week)) throw new OutsideWindowError(week);

    const subId = `${uid}_w${week}`;
    const existing = await getDoc(doc(this.db, 'submissions', subId));
    if (existing.exists()) throw new SubmissionExistsError(week);

    // 1) Upload the private proof photo FIRST. If this fails, we stop here —
    //    no Firestore document is ever written, so there is no way to end up
    //    with a "database says submitted, but there's no photo" record.
    const photoPath = `submissions/${uid}/week${week}.jpg`;
    const photoStorageRef = ref(this.storage, photoPath);
    await uploadBytes(photoStorageRef, photoBlob, { contentType: 'image/jpeg' });
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

    // 3) Best-effort anonymous feed copy. A failure here must NOT roll back
    //    or fail the submission above — the private record (the one that
    //    matters for grading) is already safely committed.
    try {
      const feedId = crypto.randomUUID();
      const feedPhotoRef = ref(this.storage, `feedPhotos/${feedId}.jpg`);
      await uploadBytes(feedPhotoRef, photoBlob, { contentType: 'image/jpeg' });
      const feedPhotoURL = await getDownloadURL(feedPhotoRef);
      const completedAfter = (await this.getMySubmissions(uid)).length;
      await setDoc(doc(this.db, 'feedPosts', feedId), {
        anonName: profile.anonName,
        week,
        reflection: reflection.trim(),
        photoURL: feedPhotoURL,
        characterType: profile.characterType,
        characterStage: getGrowthState(completedAfter).stage,
        punctualClaim: clientPunctualClaim,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('[feed] public feed copy failed (submission itself already succeeded):', err);
    }

    return { id: subId, ...submissionData, serverCreatedAt: submitDate } as unknown as Submission;
  }
}
