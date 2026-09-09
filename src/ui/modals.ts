import { PROTOTYPE_MODE } from '../config';
import { MAX_IMAGE_BYTES } from '../constants';
import { formatDateTime, getScheduledWindow, pad } from '../utils/date';
import { authoritativeSubmissionDate, isPunctualSubmission } from '../utils/punctual';
import { getGrowthState } from '../utils/growth';
import { isValidReflection } from '../utils/validation';
import { safeText } from '../utils/text';
import { formatGoalSchedule } from '../utils/goal';
import { backend, OutsideWindowError, SubmissionExistsError } from '../backend';
import type { GoalVersion, Submission } from '../types';
import { els, toast } from './dom';
import { state } from './state';
import { getWeekState } from './weekState';
import { refreshAfterSubmission } from './refresh';

// --- Photo capture (all transient, submission-modal-local state) ---
// The proof photo is taken via the native camera app or picked from the
// device's file/gallery picker (both go through the same
// <input type="file" capture="environment"> — capture="environment" only
// nudges mobile browsers toward the camera; it never removes the gallery
// option, and desktop browsers ignore it and just open the file picker).
// The original File/Blob is uploaded as-is — no canvas re-encode — so a
// high-resolution photo never has to be fully decoded into an in-memory
// canvas on the student's device. The recorded submission time always comes
// from the server (see utils/punctual.ts authoritativeSubmissionDate), never
// from anything drawn on the photo itself.
//
// Critically, the original File/Blob is also never handed to an <img> as a
// createObjectURL src: a mobile browser fully decodes whatever an <img>
// renders, and decoding a 20MB+ high-resolution camera photo into memory on
// top of everything else the PWA already holds is what was crashing the
// browser/PWA process for students on lower-memory phones (production
// incident: "메모리 부족" / silent crash reports). Instead, once a photo is
// selected we show a lightweight, decode-free status readout (checkmark +
// file size) — see showCapturedStatus below.
let capturedBlob: Blob | null = null;

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Every path that ends the current photo's usefulness (retake, modal close,
// successful submit, opening a new week's modal) routes through here, which
// also clears capturedBlob — the only path that must NOT call this is a
// failed submit, so a student can retry with the same photo instead of
// re-picking it.
function resetCameraUI() {
  capturedBlob = null;
  els.capturedStatus.classList.add('hidden');
  els.capturedStatusSize.textContent = '';
  els.cameraPlaceholder.classList.remove('hidden');
  els.cameraRetakeBtn.classList.add('hidden');
  els.prototypePhotoBtn.classList.toggle('hidden', !PROTOTYPE_MODE);
}

function showCapturedStatus(blob: Blob) {
  capturedBlob = blob;
  els.capturedStatusSize.textContent = `사진 용량: ${formatMB(blob.size)}`;
  els.capturedStatus.classList.remove('hidden');
  els.cameraPlaceholder.classList.add('hidden');
  els.cameraRetakeBtn.classList.remove('hidden');
  toast('인증샷이 준비되었습니다.', 'success');
}

function handleCameraFile(file: File | null | undefined) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('이미지 파일만 사용할 수 있습니다.', 'error');
  if (file.size > MAX_IMAGE_BYTES) {
    return toast('사진 용량이 너무 큽니다. 20MB 이하의 사진을 선택해주세요. 사진을 캡처(스크린샷)한 뒤 다시 선택하면 용량을 줄일 수 있습니다.', 'error');
  }
  showCapturedStatus(file);
}

async function makePrototypePhoto() {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 900, 1200);
  g.addColorStop(0, '#11182a');
  g.addColorStop(1, '#202b47');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 900, 1200);
  ctx.fillStyle = '#00e7ff';
  ctx.font = '800 52px sans-serif';
  ctx.fillText('15-WEEK CHALLENGE', 60, 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 38px sans-serif';
  ctx.fillText(`${state.activeSubmissionWeek ?? ''}주차 테스트 인증샷`, 60, 190);
  ctx.fillStyle = '#aeb9d0';
  ctx.font = '500 28px sans-serif';
  ctx.fillText('실제 제출에서는 휴대폰 카메라 사진이 사용됩니다.', 60, 250);
  ctx.strokeStyle = 'rgba(0,231,255,.4)';
  ctx.lineWidth = 5;
  ctx.strokeRect(60, 330, 780, 560);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fillRect(80, 350, 740, 520);
  ctx.fillStyle = '#dfe7fa';
  ctx.font = '700 32px sans-serif';
  ctx.fillText('PROTOTYPE CAMERA TEST', 205, 625);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (blob) showCapturedStatus(blob);
}

// --- Submission modal open/submit ---

export function openSubmission(week: number) {
  const st = getWeekState(week);
  if (st.status === 'done') return toast('이미 완료한 주차입니다.');
  if (!PROTOTYPE_MODE && st.status === 'expired') return toast('이미 마감된 주차라 인증할 수 없습니다.', 'error');
  if (!PROTOTYPE_MODE && st.status === 'future') return toast('아직 인증 기간이 시작되지 않았습니다.', 'error');

  state.activeSubmissionWeek = week;
  els.submitWeekLabel.textContent = `WEEK ${week}`;
  els.submitGoalText.textContent = state.profile?.goalText ?? '';
  els.reflectionText.value = '';
  els.reflectionCount.textContent = '0';
  els.prototypePunctualCheck.checked = false;
  els.prototypePunctualBox.classList.toggle('hidden', !PROTOTYPE_MODE);
  resetCameraUI();
  els.submissionModal.classList.remove('hidden');
}

export function closeSubmissionModal() {
  els.submissionModal.classList.add('hidden');
  resetCameraUI();
}

async function submitWeek() {
  const reflection = els.reflectionText.value.trim();
  if (!capturedBlob) return toast('인증샷을 먼저 촬영해주세요.', 'error');
  if (!isValidReflection(reflection)) return toast('성찰 및 다짐을 10자 이상 작성해주세요.', 'error');
  const uid = state.currentUser?.uid;
  if (state.activeSubmissionWeek === null || !state.profile || !uid) return;

  const week = state.activeSubmissionWeek;
  const stageBefore = getGrowthState(state.submissions.length).stage;
  els.submitFinalBtn.disabled = true;
  els.submitFinalBtn.textContent = '제출 중...';
  try {
    const prototypePunctualOverride = PROTOTYPE_MODE ? els.prototypePunctualCheck.checked : undefined;
    await backend.submitWeek(uid, state.profile, {
      week,
      photoBlob: capturedBlob,
      reflection,
      prototypePunctualOverride,
    });
    closeSubmissionModal();
    await refreshAfterSubmission();
    const sub = state.submissions.find((s) => Number(s.week) === week);
    const badgeWon = sub ? isPunctualSubmission(sub) : false;
    const stageAfter = getGrowthState(state.submissions.length).stage;
    const base = `${week}주차 챌린지 완료! +100 XP${badgeWon ? ' · ⏰ 정시 배지 획득!' : ''}`;
    if (stageAfter > stageBefore) {
      toast(`${base} · 새로운 모습으로 성장했어요! (Lv.${stageAfter})`, 'success');
      els.growthAvatar.classList.add('level-up-pulse');
      setTimeout(() => els.growthAvatar.classList.remove('level-up-pulse'), 900);
    } else {
      toast(base, 'success');
    }
  } catch (err) {
    console.error(err);
    // SubmissionExistsError/OutsideWindowError already carry a clean,
    // user-facing Korean message. Anything else (network failure, a raw
    // Firebase Storage/Firestore error, ...) gets a generic message instead
    // of leaking internal error text to the student — capturedBlob is left
    // untouched (no resetCameraUI() call here) so the same photo can be
    // retried without re-picking it.
    const message = err instanceof SubmissionExistsError || err instanceof OutsideWindowError
      ? err.message
      : '사진 업로드에 실패했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.';
    toast(message, 'error');
  } finally {
    els.submitFinalBtn.disabled = false;
    els.submitFinalBtn.textContent = '인증 제출하고 주차 완료';
  }
}

// --- Detail modal ---

export function openDetail(sub: Submission) {
  els.detailWeekLabel.textContent = `WEEK ${Number(sub.week)}`;
  els.detailGoal.textContent = sub.goalSnapshot?.goalText || state.profile?.goalText || '';
  const snap = sub.goalSnapshot;
  const win = getScheduledWindow(Number(sub.week), Number(snap.weekday), snap.startTime, Number(snap.duration));
  els.detailGoalSchedule.textContent = `제출 당시 설정 · ${formatGoalSchedule(snap)} · 배지 시간 ${pad(win.start.getHours())}:${pad(win.start.getMinutes())}~${pad(win.end.getHours())}:${pad(win.end.getMinutes())} · 목표 v${Number(sub.goalVersion)}`;
  const badge = isPunctualSubmission(sub);
  els.detailBadge.innerHTML = badge
    ? '<span class="tag yellow">⏰ 정해진 시간 실천 배지 획득</span>'
    : '<span class="tag">주차 내 정상 완료 · 정시 배지 없음</span>';
  els.detailPhoto.classList.remove('hidden');
  els.detailPhotoFallback.classList.add('hidden');
  els.detailPhoto.src = sub.photoURL || '';
  els.detailReflection.textContent = sub.reflection || '';
  // The displayed submission time is always the server-confirmed instant
  // (never the client-supplied submittedAt string, which a device's local
  // clock could misreport) — see utils/punctual.ts authoritativeSubmissionDate.
  const d = authoritativeSubmissionDate(sub) ?? new Date(sub.submittedAt || Date.now());
  els.detailMeta.textContent = `${formatDateTime(d)} · ${sub.status === 'test' ? '프로토타입 테스트 제출' : '주차 내 제출'}`;
  els.detailModal.classList.remove('hidden');
}

// --- Goal history modal ---

function goalHistoryHtml(history: GoalVersion[]): string {
  if (!history.length) return '<div class="panel body-sm muted">아직 목표 이력이 없습니다.</div>';
  const latest = Number(history[history.length - 1]?.version || history.length);
  return [...history]
    .reverse()
    .map((h) => {
      const d = new Date(h.changedAt || Date.now());
      const current = Number(h.version) === latest;
      return `<div class="history-item ${current ? 'current' : ''}"><div class="history-head"><div class="history-version">v${Number(h.version)}${current ? '<span class="history-badge">현재 적용</span>' : ''}</div><div class="history-date">${safeText(formatDateTime(d))}</div></div><div class="history-goal">${safeText(h.goalText || '')}</div><div class="history-schedule">${safeText(formatGoalSchedule(h))}</div></div>`;
    })
    .join('');
}

export async function openGoalHistory() {
  const uid = state.currentUser?.uid;
  if (!uid) return;
  const history = await backend.getGoalHistory(uid);
  els.goalHistoryList.innerHTML = goalHistoryHtml(history);
  els.goalHistoryModal.classList.remove('hidden');
}

// --- wiring ---

export function initModalEvents() {
  els.detailPhoto.onerror = () => {
    els.detailPhoto.classList.add('hidden');
    els.detailPhotoFallback.classList.remove('hidden');
  };
  els.cameraFileBtn.onclick = () => els.cameraFileInput.click();
  els.cameraFileInput.onchange = () => {
    const f = els.cameraFileInput.files?.[0];
    handleCameraFile(f);
    els.cameraFileInput.value = '';
  };
  els.prototypePhotoBtn.onclick = makePrototypePhoto;
  els.cameraRetakeBtn.onclick = () => resetCameraUI();
  els.reflectionText.oninput = () => {
    els.reflectionCount.textContent = String(els.reflectionText.value.length);
  };
  els.submitFinalBtn.onclick = () => void submitWeek();

  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.close!;
      document.getElementById(id)?.classList.add('hidden');
      if (id === 'submission-modal') resetCameraUI();
    };
  });
  [els.submissionModal, els.detailModal, els.historyModal, els.profileEditModal, els.deleteStudentModal, els.privacyPolicyModal].forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m) {
        m.classList.add('hidden');
        if (m === els.submissionModal) resetCameraUI();
      }
    });
  });
  els.goalHistoryBtn.onclick = () => void openGoalHistory();
}
