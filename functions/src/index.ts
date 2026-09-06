import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHash } from 'node:crypto';

initializeApp();

const TOTAL_WEEKS = 15;

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
    //     then delete every Storage object tied to them. Deleting Storage
    //     BEFORE Firestore means a mid-failure here never leaves a Firestore
    //     record pointing at an already-deleted photo — the reverse
    //     ordering risk (an orphaned photo with no Firestore record) is
    //     harmless. ignoreNotFound makes every delete idempotent, so a retry
    //     after a partial failure never errors on already-deleted files.
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
    if (studentId) {
      batch.delete(db.collection('studentIdRegistry').doc(`${semesterId}_${studentId}`));
    }
    batch.delete(db.collection('users').doc(targetUid));
    await batch.commit();

    // --- 5. Delete the Firebase Auth account itself, last — once this
    //     succeeds the student can never sign in again, so every other
    //     step above must already have succeeded first. ---
    step = 'auth';
    await auth.deleteUser(targetUid);

    // --- 6. Audit log. Identifying fields only — never reflection/photo
    //     content (see firestore.rules adminAuditLogs comment). ---
    step = 'audit-log';
    await db.collection('adminAuditLogs').add({
      action: 'deleteStudent',
      targetUid,
      targetName: name,
      targetStudentId: studentId,
      targetEmail: targetProfile.email ?? '',
      deletedBy: callerEmail,
      deletedAt: FieldValue.serverTimestamp(),
    });

    return { uid: targetUid, name, studentId, deletedWeeks };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new HttpsError('internal', `학생 삭제 실패 (단계: ${step}): ${detail}`);
  }
});
