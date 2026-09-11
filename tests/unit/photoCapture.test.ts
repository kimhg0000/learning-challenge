import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../src/constants';

// modals.ts imports ./dom, whose `els` object resolves every element by id
// at module-load time — so index.html's real markup must already be in the
// jsdom document before modals.ts is imported. Loaded here, once, like
// tests/unit/character.test.ts does for the same reason.
document.body.innerHTML = readFileSync('index.html', 'utf8');

// modals.ts imports `backend`, `OutsideWindowError` and `SubmissionExistsError`
// from ../backend, which at module-load time constructs a real
// LocalBackend/FirebaseBackend. Mocking the whole module keeps this suite
// decoupled from that construction — but the two error classes must stay
// real Error subclasses (not undefined) since modals.ts does
// `err instanceof SubmissionExistsError` in its submit-failure handler.
vi.mock('../../src/backend', () => ({
  backend: { submitWeek: vi.fn() },
  SubmissionExistsError: class SubmissionExistsError extends Error {},
  OutsideWindowError: class OutsideWindowError extends Error {},
}));
vi.mock('../../src/ui/refresh', () => ({ refreshAfterSubmission: vi.fn().mockResolvedValue(undefined), renderAll: vi.fn() }));

let els: typeof import('../../src/ui/dom').els;
let initModalEvents: typeof import('../../src/ui/modals').initModalEvents;
let openSubmission: typeof import('../../src/ui/modals').openSubmission;
let closeSubmissionModal: typeof import('../../src/ui/modals').closeSubmissionModal;
let openDetail: typeof import('../../src/ui/modals').openDetail;
let getScheduledWindow: typeof import('../../src/utils/date').getScheduledWindow;
let backend: typeof import('../../src/backend').backend;
let state: typeof import('../../src/ui/state').state;

beforeAll(async () => {
  ({ els } = await import('../../src/ui/dom'));
  ({ initModalEvents, openSubmission, closeSubmissionModal, openDetail } = await import('../../src/ui/modals'));
  ({ getScheduledWindow } = await import('../../src/utils/date'));
  ({ backend } = await import('../../src/backend'));
  ({ state } = await import('../../src/ui/state'));
  initModalEvents();
});

/** A File-like object with a fake .size, so 20-30MB byte buffers are never actually allocated in the test process. */
function fakeSizedFile(size: number, type = 'image/jpeg', name = 'photo.jpg'): File {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

function selectFile(file: File) {
  Object.defineProperty(els.cameraFileInput, 'files', { value: [file], configurable: true });
  els.cameraFileInput.onchange!(new Event('change'));
}

function fillValidReflection() {
  els.reflectionText.value = '이번 주에는 계획대로 잘 실천했습니다.';
}

function clickSubmit() {
  els.submitFinalBtn.onclick!(new Event('click'));
}

describe('photo select: no full-resolution <img> decode of the original file (P0 memory-crash fix)', () => {
  beforeEach(() => {
    vi.mocked(backend.submitWeek).mockReset();
    Object.defineProperty(els.cameraFileInput, 'files', { value: [], configurable: true });
    openSubmission(1);
  });

  it('picking a normal image file (camera capture or PC file picker — same <input>) shows a lightweight "ready" status, not an image preview', () => {
    const file = fakeSizedFile(1024 * 1024); // 1MB
    selectFile(file);

    expect(els.capturedStatus.classList.contains('hidden')).toBe(false);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(true);
    expect(els.cameraRetakeBtn.classList.contains('hidden')).toBe(false);
    expect(els.capturedStatusSize.textContent).toContain('MB');
  });

  it('there is no <img> element anywhere in the submission modal that could be handed the original file/blob to decode', () => {
    expect(document.getElementById('captured-preview')).toBeNull();
    expect(document.querySelector('#camera-box img')).toBeNull();
  });

  it('a non-image file is rejected and no status is shown', () => {
    const file = fakeSizedFile(1024, 'text/plain', 'notes.txt');
    selectFile(file);

    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(false);
  });

  it('retaking clears the ready status and restores the placeholder', () => {
    selectFile(fakeSizedFile(1024 * 1024));
    els.cameraRetakeBtn.onclick!(new Event('click'));

    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(false);
  });
});

describe('20MB client-side size guard (mirrors storage.rules — 8MB was too low for modern phone cameras)', () => {
  beforeEach(() => {
    vi.mocked(backend.submitWeek).mockReset();
    Object.defineProperty(els.cameraFileInput, 'files', { value: [], configurable: true });
    openSubmission(1);
    fillValidReflection();
    state.currentUser = { uid: 'u1', email: 'a@test.com', displayName: null };
  });

  it('a file under 20MB is accepted', () => {
    selectFile(fakeSizedFile(MAX_IMAGE_BYTES - 1));
    expect(els.capturedStatus.classList.contains('hidden')).toBe(false);
  });

  it('a file exactly at 20MB is accepted', () => {
    selectFile(fakeSizedFile(MAX_IMAGE_BYTES));
    expect(els.capturedStatus.classList.contains('hidden')).toBe(false);
  });

  it('a file over 20MB is rejected before it is ever held as the pending photo, and backend.submitWeek is never called for it', () => {
    selectFile(fakeSizedFile(MAX_IMAGE_BYTES + 1));
    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(false);

    clickSubmit();
    expect(backend.submitWeek).not.toHaveBeenCalled();
  });
});

describe('capturedBlob lifecycle: released as soon as the photo is no longer needed, kept for retry on failure', () => {
  beforeEach(() => {
    vi.mocked(backend.submitWeek).mockReset();
    Object.defineProperty(els.cameraFileInput, 'files', { value: [], configurable: true });
    openSubmission(1);
    fillValidReflection();
    state.currentUser = { uid: 'u1', email: 'a@test.com', displayName: null };
    state.profile = {
      uid: 'u1', name: '홍길동', studentId: '1234567', email: 'a@test.com',
      characterType: 'rabbit', anonName: 'anon-1', role: 'student', semesterId: 'sem',
      currentGoalVersion: 1, goalText: '매일 30분 운동', weekday: 3, startTime: '19:00', duration: 30,
      goalCreatedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    } as import('../../src/types').UserProfile;
  });

  it('without a selected photo, submitting is rejected and backend.submitWeek is never called', () => {
    clickSubmit();
    expect(backend.submitWeek).not.toHaveBeenCalled();
  });

  it('closing the modal (✕ / data-close) clears the pending photo', () => {
    selectFile(fakeSizedFile(1024 * 1024));
    document.getElementById('submission-modal')!.classList.remove('hidden');
    document.querySelector<HTMLButtonElement>('[data-close="submission-modal"]')!.onclick!(new Event('click'));

    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
    clickSubmit();
    expect(backend.submitWeek).not.toHaveBeenCalled();
  });

  it('clicking outside the modal clears the pending photo', () => {
    selectFile(fakeSizedFile(1024 * 1024));
    // Dispatched directly on the modal element itself (no children involved),
    // so e.target === els.submissionModal, exactly like a real click that
    // lands on the modal's own backdrop rather than on the card inside it.
    els.submissionModal.dispatchEvent(new Event('click'));

    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
  });

  it('re-opening the submission modal clears any leftover pending photo from before', () => {
    selectFile(fakeSizedFile(1024 * 1024));
    openSubmission(1);

    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
    expect(els.cameraPlaceholder.classList.contains('hidden')).toBe(false);
  });

  it('a successful submit clears the pending photo (modal closes, status resets)', async () => {
    vi.mocked(backend.submitWeek).mockResolvedValue({} as import('../../src/types').Submission);
    selectFile(fakeSizedFile(1024 * 1024));
    clickSubmit();
    await vi.waitFor(() => expect(backend.submitWeek).toHaveBeenCalledTimes(1));

    expect(els.submissionModal.classList.contains('hidden')).toBe(true);
    expect(els.capturedStatus.classList.contains('hidden')).toBe(true);
  });

  it('a failed submit KEEPS the pending photo so the student can retry without re-picking it', async () => {
    vi.mocked(backend.submitWeek).mockRejectedValueOnce(new Error('network down'));
    const photo = fakeSizedFile(1024 * 1024);
    selectFile(photo);
    clickSubmit();
    await vi.waitFor(() => expect(backend.submitWeek).toHaveBeenCalledTimes(1));

    // Modal stays open, status still shows the same photo as ready — capturedBlob was never nulled.
    expect(els.submissionModal.classList.contains('hidden')).toBe(false);
    expect(els.capturedStatus.classList.contains('hidden')).toBe(false);

    vi.mocked(backend.submitWeek).mockResolvedValueOnce({} as import('../../src/types').Submission);
    clickSubmit();
    await vi.waitFor(() => expect(backend.submitWeek).toHaveBeenCalledTimes(2));

    const secondCallBlob = vi.mocked(backend.submitWeek).mock.calls[1][2].photoBlob;
    expect(secondCallBlob).toBe(photo);
  });
});

describe('upload-failure messaging never leaks raw backend/Firebase error text to the student', () => {
  beforeEach(() => {
    vi.mocked(backend.submitWeek).mockReset();
    Object.defineProperty(els.cameraFileInput, 'files', { value: [], configurable: true });
    openSubmission(1);
    fillValidReflection();
    selectFile(fakeSizedFile(1024 * 1024));
    state.currentUser = { uid: 'u1', email: 'a@test.com', displayName: null };
    state.profile = {
      uid: 'u1', name: '홍길동', studentId: '1234567', email: 'a@test.com',
      characterType: 'rabbit', anonName: 'anon-1', role: 'student', semesterId: 'sem',
      currentGoalVersion: 1, goalText: '매일 30분 운동', weekday: 3, startTime: '19:00', duration: 30,
      goalCreatedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    } as import('../../src/types').UserProfile;
  });

  it('a generic/Firebase-internal error is shown as a clean, generic Korean message', async () => {
    vi.mocked(backend.submitWeek).mockRejectedValueOnce(new Error('FirebaseError: storage/unknown internal payload'));
    clickSubmit();
    await vi.waitFor(() => expect(backend.submitWeek).toHaveBeenCalledTimes(1));

    expect(els.toastWrap.textContent).toContain('사진 업로드에 실패했습니다');
    expect(els.toastWrap.textContent).not.toContain('storage/unknown');
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

  it('a submission inside its scheduled window is still shown with the punctual badge (server-time-based logic untouched by the mobile-photo-stability hotfix)', () => {
    const win = getScheduledWindow(baseSub.week, baseSnap.weekday, baseSnap.startTime, baseSnap.duration);
    const insideWindow = new Date(win.start.getTime() + 5 * 60000);
    openDetail({ ...baseSub, submittedAt: insideWindow.toISOString(), serverCreatedAt: insideWindow });

    expect(els.detailBadge.innerHTML).toContain('정해진 시간 실천 배지 획득');
  });
});
