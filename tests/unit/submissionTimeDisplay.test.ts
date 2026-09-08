import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// feed.ts (via ./admin) and admin.ts both resolve `els` from index.html and
// import ../../backend at module scope — same setup as photoCapture.test.ts.
document.body.innerHTML = readFileSync('index.html', 'utf8');

vi.mock('../../src/backend', () => ({
  backend: { submitWeek: vi.fn(), listFeed: vi.fn() },
}));

const feedSrc = readFileSync('src/ui/screens/feed.ts', 'utf8');
const adminSrc = readFileSync('src/ui/screens/admin.ts', 'utf8');
const modalsSrc = readFileSync('src/ui/modals.ts', 'utf8');

describe('submission-time display: no "인증 시각" label anywhere it is shown', () => {
  it('feed.ts (student feed + instructor feed), admin.ts (student record), and modals.ts (detail modal) never emit the "인증 시각" label', () => {
    expect(feedSrc).not.toContain('인증 시각');
    expect(adminSrc).not.toContain('인증 시각');
    expect(modalsSrc).not.toContain('인증 시각');
  });

  it('the long-form punctual phrases ("⏰ 정시 배지", "⏰ 정시 실천 배지", "정시 배지 획득") no longer appear next to a submission time — replaced by the small .punctual-chip', () => {
    expect(feedSrc).not.toMatch(/정시\s*(배지|실천 배지)/);
    expect(adminSrc).not.toContain('정시 배지 획득');
    expect(feedSrc).toContain('punctual-chip');
    expect(adminSrc).toContain('punctual-chip');
  });
});

describe('student feed (renderFeed): date/time only, with a small chip only for punctual submissions', () => {
  let state: typeof import('../../src/ui/state').state;
  let els: typeof import('../../src/ui/dom').els;
  let renderFeed: typeof import('../../src/ui/screens/feed').renderFeed;

  beforeAll(async () => {
    ({ state } = await import('../../src/ui/state'));
    ({ els } = await import('../../src/ui/dom'));
    ({ renderFeed } = await import('../../src/ui/screens/feed'));
  });

  const basePost = {
    id: 'f1', anonName: '익명 도전자', semesterId: 'sem', week: 1,
    reflection: '오늘도 완료했습니다.', photoURL: 'https://example.com/p.jpg',
    characterType: 'rabbit' as const, characterStage: 1,
    createdAt: new Date('2026-09-09T10:11:00+09:00'),
  };

  it('a non-punctual submission shows only the date/time, no chip', () => {
    state.selectedFeedWeek = 0;
    state.publicFeed = [{ ...basePost, punctualClaim: false }];
    renderFeed();

    expect(els.feedList.innerHTML).toContain('2026.09.09 10:11');
    expect(els.feedList.innerHTML).not.toContain('인증 시각');
    expect(els.feedList.innerHTML).not.toContain('punctual-chip');
  });

  it('a punctual submission shows the date/time plus a small "정시" chip — never the long "정시 배지" phrase', () => {
    state.publicFeed = [{ ...basePost, punctualClaim: true }];
    renderFeed();

    expect(els.feedList.innerHTML).toContain('2026.09.09 10:11');
    expect(els.feedList.innerHTML).toContain('<span class="punctual-chip">정시</span>');
    expect(els.feedList.innerHTML).not.toContain('정시 실천 배지');
    expect(els.feedList.innerHTML).not.toContain('정시 배지');
  });
});
