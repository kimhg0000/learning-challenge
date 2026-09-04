import type { CharacterType } from './types';

// ---------------------------------------------------------------------------
// Program calendar. PRODUCTION VALUES (the string literal defaults below)
// MUST stay in sync with the matching constants baked into firestore.rules
// (search for PROGRAM_START there) — the rules cannot read this TypeScript
// file or any env var, so a real semester change means updating this file's
// defaults AND firestore.rules together (storage.rules has no date logic).
//
// The VITE_PROGRAM_START/VITE_PROGRAM_END/VITE_SEMESTER_ID env vars exist
// ONLY so a separate staging Firebase project + staging build can point at a
// different (e.g. "start this week") calendar for pre-launch device testing,
// without ever touching these production defaults or the deployed production
// rules. A real production build (.env, no staging overrides) always falls
// back to the hardcoded production dates below — see scripts/generate-staging-rules.mjs
// for how the equivalent staging *rules* (firestore.staging.rules) are kept
// in lockstep with these, changing nothing else about the security logic.
// ---------------------------------------------------------------------------
// Falls back to process.env when import.meta.env doesn't exist at all — see
// the identical fallback (and its rationale) in src/config.ts.
const env = import.meta.env ?? process.env;

export const TOTAL_WEEKS = 15;
export const PROGRAM_START = new Date(env.VITE_PROGRAM_START || '2026-09-07T00:00:00+09:00'); // Monday of week 1, KST
export const PROGRAM_END = new Date(env.VITE_PROGRAM_END || '2026-12-20T23:59:59+09:00'); // Sunday of week 15, KST

// Every submission, feed post, and student roster entry is stamped with this
// on creation and every admin/feed query filters by it, so running this app
// again for a later semester (new SEMESTER_ID + new PROGRAM_START/END here
// and in firestore.rules) never mixes a past semester's data into the
// current one. Past-semester data is never deleted by changing this — it
// just stops appearing in the current dashboard/feed. Bump it once per
// semester, alongside PROGRAM_START/PROGRAM_END above and in firestore.rules.
export const SEMESTER_ID = env.VITE_SEMESTER_ID || '2026-fall';

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const DURATION_OPTIONS = [30, 45, 60, 75, 90, 105, 120];
export const XP_PER_COMPLETION = 100;

export interface GrowthStageDef {
  stage: number;
  minCompleted: number;
  minXp: number;
  name: string;
  mark: string;
}

// Stage boundaries: 1 (0-2 completions), 2 (3-5), 3 (6-9), 4 (10-14),
// 5 (15, i.e. every week). completedCount is the single source of truth —
// XP here is purely a derived display number (100 XP per completion), never
// a second, independently-trackable progression axis, so completion count
// and XP can never contradict each other. A punctual badge earns no XP
// bonus and is never required to reach any stage: completing all 15 weeks
// — regardless of how many were punctual — always reaches stage 5.
export const GROWTH_STAGES: GrowthStageDef[] = [
  { stage: 1, minCompleted: 0, minXp: 0, name: '새싹 동료', mark: '🌱' },
  { stage: 2, minCompleted: 3, minXp: 300, name: '습관 견습생', mark: '🎒' },
  { stage: 3, minCompleted: 6, minXp: 600, name: '집중 탐험가', mark: '✨' },
  { stage: 4, minCompleted: 10, minXp: 1000, name: '습관 수호자', mark: '⚡' },
  { stage: 5, minCompleted: 15, minXp: 1500, name: '습관 장인', mark: '👑' },
];

// Animal type is chosen once at onboarding and is permanent thereafter
// (enforced server-side too — see firestore.rules users.update). 4 types x
// 5 growth stages = 20 real illustrations at public/characters/ — see that
// folder's README for how they were generated and how art/type/stage map.
export const CHARACTER_TYPES: Record<CharacterType, { name: string; emoji: string; desc: string }> = {
  rabbit: { name: '몽글 토끼', emoji: '🐰', desc: '차분하게 한 걸음씩' },
  fox: { name: '반짝 여우', emoji: '🦊', desc: '영리하게 루틴을 설계' },
  otter: { name: '도담 수달', emoji: '🦦', desc: '즐겁게 꾸준함을 쌓기' },
  panda: { name: '포근 판다', emoji: '🐼', desc: '느긋하지만 끝까지' },
};
