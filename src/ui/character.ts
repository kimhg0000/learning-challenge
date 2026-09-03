import { CHARACTER_TYPES, GROWTH_STAGES } from '../constants';
import { getGrowthState } from '../utils/growth';
import { safeText } from '../utils/text';
import type { CharacterType } from '../types';
import { els } from './dom';
import { state } from './state';

type Size = 'small' | 'medium' | 'large';

/**
 * Renders the emoji placeholder for a character at its current growth stage.
 * Asset structure is ready for real art: drop 4 characters x 5 stage PNGs at
 * /public/characters/{type}/stage-{1..5}.png and swap the <span class="animal">
 * below for an <img> — everything else (sizing classes, stage glow, evo-mark)
 * already keys off `characterType` + `completedCount` exactly the way real
 * art would.
 */
export function characterMarkup(type: string, completedCount = 0, size: Size = 'medium'): string {
  const c = CHARACTER_TYPES[type as CharacterType] ?? CHARACTER_TYPES.rabbit;
  const g = getGrowthState(completedCount);
  return `<div class="character-orb ${size} stage-${g.stage}" title="${safeText(c.name)} · ${safeText(g.name)}"><span class="animal">${c.emoji}</span><span class="evo-mark">${g.mark}</span></div>`;
}

/** Same visual as characterMarkup, but keyed off an already-known growth stage (1-5) instead of a completion count — used for the anonymous feed, where only the stage at post time is stored, not the raw count. */
export function characterMarkupForStage(type: string, stage = 1, size: Size = 'medium'): string {
  const c = CHARACTER_TYPES[type as CharacterType] ?? CHARACTER_TYPES.rabbit;
  const clamped = Math.max(1, Math.min(GROWTH_STAGES.length, Number(stage) || 1));
  const g = GROWTH_STAGES[clamped - 1];
  return `<div class="character-orb ${size} stage-${g.stage}" title="${safeText(c.name)} · ${safeText(g.name)}"><span class="animal">${c.emoji}</span><span class="evo-mark">${g.mark}</span></div>`;
}

export function renderCharacterChoices() {
  els.characterGrid.innerHTML = Object.entries(CHARACTER_TYPES)
    .map(
      ([key, c]) =>
        `<button type="button" class="character-choice ${state.selectedCharacter === key ? 'active' : ''}" data-character="${key}">${characterMarkup(key, 0, 'medium')}<div class="character-choice-name">${safeText(c.name)}</div><div class="character-choice-desc">${safeText(c.desc)}</div></button>`,
    )
    .join('');
  els.characterGrid.querySelectorAll<HTMLButtonElement>('[data-character]').forEach((b) => {
    b.onclick = () => {
      state.selectedCharacter = b.dataset.character ?? null;
      renderCharacterChoices();
    };
  });
}
