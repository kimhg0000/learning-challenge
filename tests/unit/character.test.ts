import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GROWTH_STAGES } from '../../src/constants';

// character.ts imports ./dom, whose `els` object resolves ~80 elements by
// id at module-load time (throwing if any is missing) — so index.html's
// real markup must be in the jsdom document BEFORE character.ts is
// imported. Loaded here, once, rather than per-test.
document.body.innerHTML = readFileSync('index.html', 'utf8');
let characterMarkup: typeof import('../../src/ui/character').characterMarkup;
let characterMarkupForStage: typeof import('../../src/ui/character').characterMarkupForStage;
beforeAll(async () => {
  ({ characterMarkup, characterMarkupForStage } = await import('../../src/ui/character'));
});

const ANIMALS = ['rabbit', 'fox', 'otter', 'panda'] as const;

describe('character art mapping (animal type x growth stage are independent axes)', () => {
  it.each(ANIMALS)('%s: characterMarkupForStage(1..5) points at that animal\'s own stage-N asset, never another animal or stage', (animal) => {
    for (const { stage } of GROWTH_STAGES) {
      const html = characterMarkupForStage(animal, stage, 'medium');
      expect(html).toContain(`/characters/${animal}/stage-${stage}.webp`);
      // Never accidentally reference a different animal or a different stage's file.
      for (const other of ANIMALS) {
        if (other !== animal) expect(html).not.toContain(`/characters/${other}/`);
      }
      for (const { stage: otherStage } of GROWTH_STAGES) {
        if (otherStage !== stage) expect(html).not.toContain(`stage-${otherStage}.webp`);
      }
    }
  });

  it('characterMarkup(type, completedCount) derives the asset from completedCount via the same stage thresholds as getGrowthState — an animal never changes when only completedCount changes', () => {
    const rabbitStage1 = characterMarkup('rabbit', 2, 'medium'); // stage 1 (0-2)
    const rabbitStage2 = characterMarkup('rabbit', 3, 'medium'); // stage 2 (3-5)
    const rabbitStage5 = characterMarkup('rabbit', 15, 'medium'); // stage 5
    expect(rabbitStage1).toContain('/characters/rabbit/stage-1.webp');
    expect(rabbitStage2).toContain('/characters/rabbit/stage-2.webp');
    expect(rabbitStage5).toContain('/characters/rabbit/stage-5.webp');
    // The animal folder is always "rabbit" regardless of stage — growing
    // never turns one animal type into another.
    expect(rabbitStage1).toContain('/characters/rabbit/');
    expect(rabbitStage2).toContain('/characters/rabbit/');
    expect(rabbitStage5).toContain('/characters/rabbit/');
  });

  it('an unknown animal type falls back to rabbit rather than producing a broken path', () => {
    const html = characterMarkup('not-a-real-animal', 0, 'medium');
    expect(html).toContain('/characters/rabbit/stage-1.webp');
  });

  it('every <img> carries an onerror fallback to the emoji rendering, so a missing asset never breaks the layout', () => {
    const html = characterMarkupForStage('panda', 3, 'small');
    expect(html).toContain('onerror=');
    expect(html).toContain('🐼');
  });
});
