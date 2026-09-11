import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions';
import { ensureThumbnail, errorCode } from './feedPhotos';

initializeApp();

const TOTAL_WEEKS = 15;

// Mirrors src/constants.ts GROWTH_STAGES (stage/minCompleted only — this
// function only ever needs the numeric stage, never the display name/mark).
// Functions has its own build and cannot import from src/, so this is kept
// in lockstep by hand; if the stage boundaries ever change, update both.
const GROWTH_STAGE_BOUNDARIES: Array<{ stage: number; minCompleted: number }> = [
  { stage: 1, minCompleted: 0 },
  { stage: 2, minCompleted: 3 },
  { stage: 3, minCompleted: 6 },
  { stage: 4, minCompleted: 10 },
  { stage: 5, minCompleted: 15 },
];

function growthStageFor(completedCount: number): number {
  let stage = GROWTH_STAGE_BOUNDARIES[0].stage;
  for (const s of GROWTH_STAGE_BOUNDARIES) {
    if (completedCount >= s.minCompleted) stage = s.stage;
  }
  return stage;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

interface DeleteStudentRequest {
  targetUid?: unknown;
}

/**
 * Instructor-only privileged deletion of a single student account and every
 * piece of data tied to it. Runs entirely on the Admin SDK (bypasses
 * Firestore/Storage security rules by design — those rules deliberately
 * make submissions/goalVersions/profileHistory/feedPosts immutable and
 * un-deletable from ANY client, instructor included; see firestore.rules).
 *
 * The caller's instructor status and the target's protected status are both
 * re-derived here from Firestore, never trusted from the request payload —
 * the only client-supplied value used is targetUid.
 */
export const deleteStudentAccount = onCall<DeleteStudentRequest>(async (request) => {
  const auth = getAuth();
  const db = getFirestore();
  const storage = getStorage();

  // --- 1. Caller must be a signed-in, allowlisted instructor ---
  const callerToken = request.auth;
  if (!callerToken || !callerToken.token.email) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  const callerEmail = callerToken.token.email.toLowerCase();
  if (callerToken.token.email_verified !== true) {
    throw new HttpsError('permission-denied', '이메일 인증이 완료된 교수자 계정이 필요합니다.');
  }
  const callerUid = callerToken.uid;

  const callerAllowlistDoc = await db.collection('instructorAllowlist').doc(callerEmail).get();
  if (!callerAllowlistDoc.exists) {
    throw new HttpsError('permission-denied', '교수자 권한이 없습니다.');
  }

  const targetUid = (request.data as DeleteStudentRequest | undefined)?.targetUid;
  if (typeof targetUid !== 'string' || !targetUid) {
    throw new HttpsError('invalid-argument', '삭제할 학생 계정을 지정해주세요.');
  }
  if (targetUid === callerUid) {
    throw new HttpsError('failed-precondition', '본인 계정은 이 기능으로 삭제할 수 없습니다.');
  }

  // --- 2. Target must exist, be a student, and never be an instructor ---
  const targetProfileSnap = await db.collection('users').doc(targetUid).get();
  if (!targetProfileSnap.exists) {
    throw new HttpsError('not-found', '학생 계정을 찾을 수 없습니다.');
  }
  const targetProfile = targetProfileSnap.data() as Record<string, unknown>;
  if (targetProfile.role !== 'student') {
    throw new HttpsError('permission-denied', '교수자 계정은 이 기능으로 삭제할 수 없습니다.');
  }
  const targetEmail = typeof targetProfile.email === 'string' ? targetProfile.email.toLowerCase() : '';
  if (targetEmail) {
    const targetAllowlistDoc = await db.collection('instructorAllowlist').doc(targetEmail).get();
    if (targetAllowlistDoc.exists) {
      throw new HttpsError('permission-denied', '교수자로 등록된 계정은 삭제할 수 없습니다.');
    }
  }

  const semesterId = typeof targetProfile.semesterId === 'string' ? targetProfile.semesterId : '';
  const studentId = typeof targetProfile.studentId === 'string' ? targetProfile.studentId : '';
  const name = typeof targetProfile.name === 'string' ? targetProfile.name : '';
  if (!semesterId) {
    throw new HttpsError('failed-precondition', '학생 프로필에 semesterId가 없어 안전하게 삭제할 수 없습니다.');
  }

  let step = 'storage';
  try {
    // --- 3. Find this student's submissions and derive their public feed
    //     post ids (feedId = sha256(subId), see FirebaseBackend.submitWeek),
    //     then delete every Storage object tied to them. Keep the profile
    //     until Auth deletion succeeds, so an instructor can retry failures.
    //     A partial Storage failure may temporarily leave a missing image;
    //     ignoreNotFound lets the retry safely finish the remaining work.
    const bucket = storage.bucket();
    const deletedWeeks: number[] = [];
    const feedIds: string[] = [];

    for (let week = 1; week <= TOTAL_WEEKS; week++) {
      const subId = `${targetUid}_${semesterId}_w${week}`;
      const subSnap = await db.collection('submissions').doc(subId).get();
      if (!subSnap.exists) continue;
      deletedWeeks.push(week);
      const feedId = sha256Hex(subId);
      feedIds.push(feedId);

      await bucket.file(`submissions/${targetUid}/${semesterId}/week${week}.jpg`).delete({ ignoreNotFound: true });
      await bucket.file(`feedPhotos/${feedId}.jpg`).delete({ ignoreNotFound: true });
    }

    // Delete Auth while the authoritative student profile still exists.
    // If Auth fails, retry remains authorized from that profile. If Auth
    // succeeded but Firestore later fails, user-not-found is a safe retry.
    step = 'auth';
    try { await auth.deleteUser(targetUid); }
    catch (error) { if (errorCode(error) !== 'auth/user-not-found') throw error; }

    // --- 4. Delete every Firestore document tied to this uid, in one batch
    //     so it can never partially apply. ---
    step = 'firestore';
    const batch = db.batch();
    deletedWeeks.forEach((week, i) => {
      batch.delete(db.collection('submissions').doc(`${targetUid}_${semesterId}_w${week}`));
      batch.delete(db.collection('feedPosts').doc(feedIds[i]));
    });
    const goalVersionsSnap = await db.collection('users').doc(targetUid).collection('goalVersions').get();
    goalVersionsSnap.forEach((d) => batch.delete(d.ref));
    const profileHistorySnap = await db.collection('users').doc(targetUid).collection('profileHistory').get();
    profileHistorySnap.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection('users').doc(targetUid).collection('privacyConsent').doc('record'));
    const registrySnap = await db.collection('studentIdRegistry').where('uid', '==', targetUid).get();
    registrySnap.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('users').doc(targetUid));
    // Commit the audit atomically with deletion, avoiding a missing-profile
    // retry after a separate audit-log write failure.
    batch.set(db.collection('adminAuditLogs').doc(), {
      action: 'deleteStudent',
      targetUid,
      targetName: name,
      targetStudentId: studentId,
      targetEmail: targetProfile.email ?? '',
      deletedBy: callerEmail,
      deletedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { uid: targetUid, name, studentId, deletedWeeks };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new HttpsError('internal', `학생 삭제 실패 (단계: ${step}): ${detail}`);
  }
});

interface PublishFeedPostRequest {
  week?: unknown;
}

interface PublishFeedPostResult {
  feedId: string;
  photoURL: string;
}

/**
 * Publishes the anonymous feed copy of a student's own already-committed
 * private submission, via a SERVER-SIDE JPEG thumbnail — the student's
 * device never uploads the same photo bytes twice (see
 * FirebaseBackend.submitWeek(), which used to upload the same Blob a second
 * time to feedPhotos/{feedId}.jpg from the client; that second client upload
 * is now removed and replaced with this call).
 *
 * The only client-supplied value trusted here is `week`. Everything else
 * (uid, semesterId, profile fields, the submission itself) is re-read from
 * Firestore/Auth server-side, the same trust model deleteStudentAccount
 * above already uses. feedId stays `sha256(subId)` — identical to the
 * previous client-side derivation — so this is a drop-in replacement for
 * deleteStudentAccount's existing feedPhotos/{feedId}.jpg deletion, and for
 * every already-published feedPosts document.
 */
export const publishFeedPost = onCall<PublishFeedPostRequest>({ memory: '1GiB', concurrency: 1, maxInstances: 5, timeoutSeconds: 60 }, async (request): Promise<PublishFeedPostResult> => {
  const db = getFirestore();
  const storage = getStorage();

  // --- 1. Caller must be signed in. uid comes from the verified ID token, never the request body. ---
  const callerToken = request.auth;
  if (!callerToken) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  const uid = callerToken.uid;

  const weekRaw = (request.data as PublishFeedPostRequest | undefined)?.week;
  const week = Number(weekRaw);
  if (!Number.isInteger(week) || week < 1 || week > TOTAL_WEEKS) {
    throw new HttpsError('invalid-argument', '유효하지 않은 주차입니다.');
  }

  // --- 2. Re-derive semesterId from the caller's OWN profile — never a
  //     hardcoded constant, and never client-supplied. Same source
  //     deleteStudentAccount already trusts for the target's semesterId. ---
  const profileSnap = await db.collection('users').doc(uid).get();
  if (!profileSnap.exists) {
    throw new HttpsError('failed-precondition', '학생 프로필을 찾을 수 없습니다.');
  }
  const profile = profileSnap.data() as Record<string, unknown>;
  const semesterId = typeof profile.semesterId === 'string' ? profile.semesterId : '';
  if (!semesterId) {
    throw new HttpsError('failed-precondition', '프로필에 semesterId가 없어 안전하게 게시할 수 없습니다.');
  }

  // --- 3. The submission this post is derived from must be this caller's own, real, already-committed submission. ---
  const subId = `${uid}_${semesterId}_w${week}`;
  const subSnap = await db.collection('submissions').doc(subId).get();
  if (!subSnap.exists) {
    throw new HttpsError('not-found', '해당 주차의 제출을 찾을 수 없습니다.');
  }
  const submission = subSnap.data() as Record<string, unknown>;
  if (submission.userId !== uid || submission.semesterId !== semesterId || submission.week !== week || submission.status !== 'submitted') {
    throw new HttpsError('permission-denied', '본인의 제출만 게시할 수 있습니다.');
  }
  const expectedPhotoPath = `submissions/${uid}/${semesterId}/week${week}.jpg`;
  if (submission.photoStoragePath !== expectedPhotoPath) {
    throw new HttpsError('failed-precondition', '제출 사진 경로가 예상과 일치하지 않습니다.');
  }

  const feedId = sha256Hex(subId);

  // --- 4. Idempotency short-circuit. feedId is deterministic, so a retried
  //     call (client bounded-retry, or any duplicate invocation) must never
  //     re-copy the photo, mint a second token, or re-write the post — it
  //     just returns the same result the first successful call produced. ---
  const existingFeedSnap = await db.collection('feedPosts').doc(feedId).get();
  if (existingFeedSnap.exists) {
    const existing = existingFeedSnap.data() as { photoURL?: string };
    return { feedId, photoURL: existing.photoURL || '' };
  }

  let step = 'thumbnail';
  try {
    // --- 5. Only the server decodes the original; private bytes stay intact. ---
    const bucket = storage.bucket();
    const srcFile = bucket.file(expectedPhotoPath);
    const destPath = `feedPhotos/${feedId}.jpg`;
    const destFile = bucket.file(destPath);
    const photoURL = await ensureThumbnail(srcFile, destFile);

    // --- 6. characterStage: count this student's total completed
    //     submissions this semester. Bounded to TOTAL_WEEKS (<=15) document
    //     reads — never a collection-wide query — same cost the client paid
    //     for this exact computation before it moved server-side. ---
    step = 'character-stage';
    const weekIds = Array.from({ length: TOTAL_WEEKS }, (_, i) => `${uid}_${semesterId}_w${i + 1}`);
    const weekSnaps = await Promise.all(weekIds.map((id) => db.collection('submissions').doc(id).get()));
    const completedCount = weekSnaps.filter((s) => s.exists).length;
    const characterStage = growthStageFor(completedCount);

    // --- 7. Write feedPosts with EXACTLY the existing schema (see
    //     firestore.rules feedPosts.create hasOnly()) — no uid/name/
    //     studentId/email, ever. ---
    step = 'firestore-write';
    const anonName = typeof profile.anonName === 'string' ? profile.anonName : '';
    const characterType = typeof profile.characterType === 'string' ? profile.characterType : 'rabbit';
    const reflection = typeof submission.reflection === 'string' ? submission.reflection : '';
    const punctualClaim = submission.clientPunctualClaim === true;

    const post = {
      anonName,
      semesterId,
      week,
      reflection,
      photoURL,
      characterType,
      characterStage,
      punctualClaim,
      createdAt: FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('feedPosts').doc(feedId).create(post);
    } catch (error) {
      if (errorCode(error) !== '6' && errorCode(error) !== 'already-exists') throw error;
      const winner = await db.collection('feedPosts').doc(feedId).get();
      if (!winner.exists) throw new Error('feed/disappeared');
      return { feedId, photoURL: String(winner.get('photoURL')) };
    }

    return { feedId, photoURL };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('feed/publish-failed', { feedId, step, code: errorCode(err), reason: err instanceof Error ? err.message : 'unknown' });
    throw new HttpsError('internal', '피드 사진 처리에 실패했습니다. 인증 제출 원본은 보존됩니다.');
  }
});
