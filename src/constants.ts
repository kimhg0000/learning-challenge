import type { CharacterType } from './types';

// ---------------------------------------------------------------------------
// Program calendar. This value MUST stay in sync with the matching constant
// baked into firestore.rules and storage.rules (search for PROGRAM_START in
// those files) — the rules cannot read this TypeScript file, so if you ever
// need to run this for a different semester, update all three places.
// ---------------------------------------------------------------------------
export const TOTAL_WEEKS = 15;
export const PROGRAM_START = new Date('2026-09-07T00:00:00+09:00'); // Monday of week 1, KST
export const PROGRAM_END = new Date('2026-12-20T23:59:59+09:00'); // Sunday of week 15, KST

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
