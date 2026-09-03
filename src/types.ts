export type CharacterType = 'rabbit' | 'fox' | 'otter' | 'panda';

export interface GoalSettings {
  goalText: string;
  weekday: number; // 0=Sun .. 6=Sat
  startTime: string; // "HH:MM"
  duration: number; // minutes, <= 120
}

export type GoalChangeType = 'initial' | 'edit';

export interface GoalVersion extends GoalSettings {
  version: number;
  changedAt: string; // ISO string (denormalized copy of the server timestamp for display)
  changeType: GoalChangeType;
}

export interface UserProfile {
  uid: string;
  name: string;
  studentId: string;
  email: string;
  characterType: CharacterType;
  anonName: string;
  role: 'student' | 'instructor';
  currentGoalVersion: number;
  goalText: string;
  weekday: number;
  startTime: string;
  duration: number;
  goalCreatedAt: string;
  updatedAt: string;
  createdAt: string;
}

export interface GoalSnapshot extends GoalSettings {
  version: number;
}

export interface Submission {
  id: string; // `${uid}_w${week}`
  userId: string;
  week: number;
  goalVersion: number;
  goalSnapshot: GoalSnapshot;
  reflection: string;
  photoURL: string;
  photoStoragePath: string;
  submittedAt: string; // client-side ISO, display only, never trusted for grading
  serverCreatedAt: unknown; // Firestore Timestamp once read back; source of truth for punctuality
  clientPunctualClaim: boolean; // optimistic, UI-only; authoritative value is recomputed from serverCreatedAt
  status: 'submitted' | 'test';
}

export interface FeedPost {
  id: string;
  anonName: string;
  week: number;
  reflection: string;
  photoURL: string;
  characterType: CharacterType;
  characterStage: number;
  punctualClaim: boolean;
  createdAt: unknown;
}

export interface WeekState {
  status: 'done' | 'open' | 'future' | 'expired' | 'test';
  start: Date;
  end: Date;
  sub?: Submission;
}
