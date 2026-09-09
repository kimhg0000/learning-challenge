import type { AuthUser } from '../backend/types';
import type { FeedPost, Submission, UserProfile } from '../types';

export interface AppState {
  currentUser: AuthUser | null;
  profile: UserProfile | null;
  submissions: Submission[];
  publicFeed: FeedPost[];
  homeRecentFeed: FeedPost[];
  selectedFeedWeek: number; // 0 = all
  feedPage: number; // 1-based; reset to 1 whenever the week filter or instructor search changes
  prototypeWeek: number;
  editingGoal: boolean;
  authMode: 'login' | 'signup';
  selectedCharacter: string | null;
  selectedWeekday: number | null;
  activeSubmissionWeek: number | null;
}

export const state: AppState = {
  currentUser: null,
  profile: null,
  submissions: [],
  publicFeed: [],
  homeRecentFeed: [],
  selectedFeedWeek: 0,
  feedPage: 1,
  prototypeWeek: 1,
  editingGoal: false,
  authMode: 'login',
  selectedCharacter: null,
  selectedWeekday: null,
  activeSubmissionWeek: null,
};
