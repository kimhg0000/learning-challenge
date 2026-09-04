import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// index.html is the single source of truth for what UI actually ships —
// checking it directly (rather than only src/ui/modals.ts's JS logic) is
// what actually proves the live-camera controls are gone, since removing
// only the JS but leaving stray markup behind would still leave a visible,
// non-functional button on screen.
const html = readFileSync('index.html', 'utf8');

describe('submission modal: live camera removed, native-camera-app capture kept', () => {
  it('no live getUserMedia video preview or its start/capture buttons remain', () => {
    expect(html).not.toContain('id="camera-video"');
    expect(html).not.toContain('id="camera-start-btn"');
    expect(html).not.toContain('id="camera-capture-btn"');
    expect(html).not.toContain('실시간 카메라');
    expect(html).not.toContain('실시간 촬영');
  });

  it('the native-camera-app capture path (file input + trigger button + preview) is intact', () => {
    expect(html).toContain('id="camera-file-input"');
    expect(html).toMatch(/id="camera-file-input"[^>]*capture="environment"/);
    expect(html).toContain('id="camera-file-btn"');
    expect(html).toContain('id="captured-preview"');
    expect(html).toContain('id="camera-retake-btn"');
  });
});

describe('goal-edit screen is reachable only from 내 정보, with no route back to onboarding', () => {
  it('there is exactly one goal-back-btn, shared between onboarding and edit mode (auth.ts branches its behavior on state.editingGoal, not a second button)', () => {
    const matches = html.match(/id="goal-back-btn"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('permanent-character notice is shown at the original selection step', () => {
  it('the onboarding character-selection step warns that the choice is permanent', () => {
    expect(html).toContain('변경할 수 없습니다');
  });

  it('내 정보 offers no character-change control', () => {
    expect(html).not.toContain('캐릭터 변경');
  });
});
