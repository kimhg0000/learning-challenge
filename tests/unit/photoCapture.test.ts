import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// modals.ts imports ./dom, whose `els` object resolves every element by id
// at module-load time — so index.html's real markup must already be in the
// jsdom document before modals.ts is imported. Loaded here, once, like
// tests/unit/character.test.ts does for the same reason.
document.body.innerHTML = readFileSync('index.html', 'utf8');

// jsdom does not implement the Blob URL APIs at all (window.URL.createObjectURL
// is simply undefined). The new capture flow uses them instead of a canvas
// re-encode specifically to avoid ever fully decoding a high-resolution photo
// in memory, so a minimal in-memory stand-in is enough to exercise that path
// under jsdom without a real browser.
const objectUrls = new Map<string, Blob>();
let objectUrlCounter = 0;
(globalThis.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (blob: Blob) => {
  const url = `blob:mock-${objectUrlCounter++}`;
  objectUrls.set(url, blob);
  return url;
};
const revokeObjectURL = vi.fn((url: string) => {
  objectUrls.delete(url);
});
(globalThis.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revokeObjectURL;

// modals.ts imports `backend` from ../backend, which at module-load time
// constructs a real LocalBackend/FirebaseBackend depending on env. None of
// the tests below submit a week, but mocking it keeps this suite decoupled
// from that construction entirely.
vi.mock('../../src/backend', () => ({
  backend: { submitWeek: vi.fn() },
}));

let els: typeof import('../../src/ui/dom').els;
let initModalEvents: typeof import('../../src/ui/modals').initModalEvents;
let openDetail: typeof import('../../src/ui/modals').openDetail;
let getScheduledWindow: typeof import('../../src/utils/date').getScheduledWindow;

beforeAll(async () => {
  ({ els } = await import('../../src/ui/dom'));
  ({ initModalEvents, openDetail } = await import('../../src/ui/modals'));
  ({ getScheduledWindow } = await import('../../src/utils/date'));
  initModalEvents();
});

function selectFile(file: File) {
  Object.defineProperty(els.cameraFileInput, 'files', { value: [file], configurable: true });
  els.cameraFileInput.onchange!(new Event('change'));
}

describe('photo select/preview: no canvas watermark re-encode', () => {
  beforeEach(() => {
    objectUrls.clear();
    revokeObjectURL.mockClear();
    els.cameraFileInput.onclick = null;
    Object.defineProperty(els.cameraFileInput, 'files', { value: [], configurable: true });
    els.capturedPreview.src = '';
    els.capturedPreview.classList.add('hidden');
    els.cameraPlaceholder.classList.remove('hidden');
    els.cameraRetakeBtn.classList.add('hidden');
  });

  it('picking an image file (camera capture or PC file picker — same <input>) previews it via an object URL pointing at the ORIGINAL file, not a canvas re-encode', () => {
    const file = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(file);

    expect(els.capturedPreview.classList.contains('hidden')).toBe(false);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(true);
    expect(els.cameraRetakeBtn.classList.contains('hidden')).toBe(false);
    expect(els.capturedPreview.src).toMatch(/^blob:mock-/);
    // The exact same File instance was handed to createObjectURL — proves
    // the original bytes are what gets previewed (and later uploaded),
    // never a canvas-drawn/re-encoded copy of it.
    expect(objectUrls.get(els.capturedPreview.src)).toBe(file);
  });

  it('a non-image file is rejected and no preview is shown', () => {
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    selectFile(file);

    expect(els.capturedPreview.classList.contains('hidden')).toBe(true);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(false);
  });

  it('retaking a photo revokes the previous object URL and restores the placeholder', () => {
    const file = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(file);
    const firstUrl = els.capturedPreview.src;

    els.cameraRetakeBtn.onclick!(new Event('click'));

    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(els.capturedPreview.classList.contains('hidden')).toBe(true);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(false);
  });

  it('selecting a second photo revokes the first preview URL before creating the new one (no leaked object URLs across retakes/high-res photos)', () => {
    const first = new File([new Uint8Array(10)], 'first.jpg', { type: 'image/jpeg' });
    const second = new File([new Uint8Array(20)], 'second.jpg', { type: 'image/jpeg' });
    selectFile(first);
    const firstUrl = els.capturedPreview.src;
    selectFile(second);

    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(objectUrls.get(els.capturedPreview.src)).toBe(second);
  });
});

describe('detail modal: authentication time is server-sourced and clearly labeled', () => {
  const baseSnap = { version: 1, goalText: '매일 30분 운동', weekday: 3, startTime: '19:00', duration: 30 };
  const baseSub = {
    id: 's1', userId: 'u1', semesterId: 'sem', week: 1, goalVersion: 1,
    goalSnapshot: baseSnap, reflection: '잘 했습니다.', photoURL: 'https://example.com/p.jpg',
    photoStoragePath: 'submissions/u1/sem/week1.jpg', clientPunctualClaim: false, status: 'submitted' as const,
  };

  it('shows the bare server-confirmed date/time (no "인증 시각" label prefix), never the client submittedAt when serverCreatedAt is present', () => {
    const serverTime = new Date('2026-09-08T19:50:00+09:00');
    openDetail({ ...baseSub, submittedAt: '2099-01-01T00:00:00.000Z', serverCreatedAt: serverTime });

    expect(els.detailMeta.textContent).not.toContain('인증 시각');
    expect(els.detailMeta.textContent).toContain('2026');
    expect(els.detailMeta.textContent).not.toContain('2099');
  });

  it('a submission inside its scheduled window is still shown with the punctual badge (server-time-based logic untouched by the watermark removal)', () => {
    const win = getScheduledWindow(baseSub.week, baseSnap.weekday, baseSnap.startTime, baseSnap.duration);
    const insideWindow = new Date(win.start.getTime() + 5 * 60000);
    openDetail({ ...baseSub, submittedAt: insideWindow.toISOString(), serverCreatedAt: insideWindow });

    expect(els.detailBadge.innerHTML).toContain('정해진 시간 실천 배지 획득');
  });
});
