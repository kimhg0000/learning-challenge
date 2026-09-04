import { CHARACTER_TYPES, GROWTH_STAGES } from '../constants';
import { getGrowthState } from '../utils/growth';
import { safeText } from '../utils/text';
import type { CharacterType } from '../types';
import { els } from './dom';
import { state } from './state';

type Size = 'small' | 'medium' | 'large';

/**
 * The animal TYPE (rabbit/fox/otter/panda) is permanent from onboarding
 * onward; growth STAGE (1-5, derived from completion count) is a fully
 * separate axis layered on top of it — a rabbit is a rabbit at every
 * stage, it just grows from the stage-1 illustration into the stage-5
 * one. Real art lives at /public/characters/{type}/stage-{1-5}.webp (see
 * that folder's README for provenance/regeneration); the emoji is kept
 * only as an automatic <img onerror> fallback if an asset is ever missing.
 */
function orbMarkup(c: { name: string; emoji: string }, type: string, g: { stage: number; name: string; mark: string }, size: Size): string {
  const safeType = safeText(type);
  const label = safeText(`${c.name} · ${g.name}`);
  const fallbackHtml = `<span class="animal">${c.emoji}</span>`.replace(/"/g, '&quot;');
  return `<div class="character-orb ${size} stage-${g.stage}" title="${label}"><img class="animal-art" src="/characters/${safeType}/stage-${g.stage}.webp" alt="${label}" onerror="this.outerHTML='${fallbackHtml}'"><span class="evo-mark">${g.mark}</span></div>`;
}

function resolveType(type: string): CharacterType {
  return type in CHARACTER_TYPES ? (type as CharacterType) : 'rabbit';
}

export function characterMarkup(type: string, completedCount = 0, size: Size = 'medium'): string {
  const resolved = resolveType(type);
  const g = getGrowthState(completedCount);
  return orbMarkup(CHARACTER_TYPES[resolved], resolved, g, size);
}

/** Same visual as characterMarkup, but keyed off an already-known growth stage (1-5) instead of a completion count — used for the anonymous feed, where only the stage at post time is stored, not the raw count. */
export function characterMarkupForStage(type: string, stage = 1, size: Size = 'medium'): string {
  const resolved = resolveType(type);
  const clamped = Math.max(1, Math.min(GROWTH_STAGES.length, Number(stage) || 1));
  const g = GROWTH_STAGES[clamped - 1];
  return orbMarkup(CHARACTER_TYPES[resolved], resolved, g, size);
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
