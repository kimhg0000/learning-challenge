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
const env = import.meta.env;

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

export const GROWTH_STAGES: GrowthStageDef[] = [
  { stage: 1, minCompleted: 0, minXp: 0, name: '새싹 동료', mark: '🌱' },
  { stage: 2, minCompleted: 3, minXp: 300, name: '습관 견습생', mark: '🎒' },
  { stage: 3, minCompleted: 6, minXp: 600, name: '집중 탐험가', mark: '✨' },
  { stage: 4, minCompleted: 10, minXp: 1000, name: '습관 수호자', mark: '⚡' },
  { stage: 5, minCompleted: 13, minXp: 1300, name: '최종 성장형', mark: '👑' },
];

// Asset structure ready for the 4 characters x 5 stages = 20 real illustrations:
// place files at /public/characters/{characterType}/stage-{1..5}.png and swap
// the emoji fallback in ui/components/character.ts for an <img> once ready.
export const CHARACTER_TYPES: Record<CharacterType, { name: string; emoji: string; desc: string }> = {
  rabbit: { name: '몽글 토끼', emoji: '🐰', desc: '차분하게 한 걸음씩' },
  fox: { name: '반짝 여우', emoji: '🦊', desc: '영리하게 루틴을 설계' },
  otter: { name: '도담 수달', emoji: '🦦', desc: '즐겁게 꾸준함을 쌓기' },
  panda: { name: '포근 판다', emoji: '🐼', desc: '느긋하지만 끝까지' },
};
