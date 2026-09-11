import { beforeAll, describe, expect, it } from 'vitest';
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref, getMetadata } from 'firebase/storage';
import { SEMESTER_ID } from '../../src/constants';
import {
  setupIntegrationRules,
  createStudent,
  createInstructor,
  withRulesDisabled,
  withStorageRulesDisabled,
  sha256Hex,
  tinyJpegBlob,
} from './helpers';

// Exercises the REAL deleteStudentAccount Cloud Function (Admin SDK, running
// against the Functions emulator — see package.json "integration:test" and
// firebase.json's emulators.functions), called through the same
// FirebaseBackend.adminDeleteStudent() the instructor admin screen uses.
// Nothing here is mocked: instructor-allowlist checks, Firestore deletes,
// Storage deletes, and the Auth account deletion are all the real thing.

beforeAll(async () => {
  await setupIntegrationRules();
});

async function submissionPhotoPath(uid: string, week: number): Promise<string> {
  return `submissions/${uid}/${SEMESTER_ID}/week${week}.jpg`;
}
async function feedPhotoPath(uid: string, week: number): Promise<string> {
  const feedId = await sha256Hex(`${uid}_${SEMESTER_ID}_w${week}`);
  return `feedPhotos/${feedId}.jpg`;
}
async function feedIdFor(uid: string, week: number): Promise<string> {
  return sha256Hex(`${uid}_${SEMESTER_ID}_w${week}`);
}

describe('deleteStudentAccount — authorization', () => {
  it('a regular student cannot call the delete function at all', async () => {
    const { backend: studentBackend, uid: studentUid } = await createStudent('delete-auth-caller@student.example');
    const { uid: victimUid } = await createStudent('delete-auth-victim1@student.example');
    await expect(studentBackend.adminDeleteStudent(victimUid)).rejects.toThrow();
    // Also can't delete themselves through this path.
    await expect(studentBackend.adminDeleteStudent(studentUid)).rejects.toThrow();
  });

  it('a student cannot delete another student either (same rejection path as any non-instructor call)', async () => {
    const { backend: studentBackend } = await createStudent('delete-auth-attacker@student.example');
    const { uid: victimUid } = await createStudent('delete-auth-victim2@student.example');
    await expect(studentBackend.adminDeleteStudent(victimUid)).rejects.toThrow();

    // Victim is untouched.
    const stillThere = await withRulesDisabled((db) => getDoc(doc(db, 'users', victimUid)));
    expect(stillThere.exists()).toBe(true);
  });

  it('an instructor cannot delete another instructorAllowlist account, even if its profile role is wrong', async () => {
    const { backend: instructorBackend } = await createInstructor(`delete-auth-instructor1-${Date.now()}@univ.example`);
    const { backend: otherInstructorBackend, uid: otherInstructorUid } = await createInstructor(
      `delete-auth-instructor2-${Date.now()}@univ.example`,
    );
    await expect(instructorBackend.adminDeleteStudent(otherInstructorUid)).rejects.toThrow();
    // Confirm the other instructor's backend still works (account untouched).
    await expect(otherInstructorBackend.adminListStudents()).resolves.toBeInstanceOf(Array);
  });

  it('an instructor cannot delete their own account through this function', async () => {
    const { backend: instructorBackend, uid: instructorUid } = await createInstructor(`delete-auth-self-${Date.now()}@univ.example`);
    await expect(instructorBackend.adminDeleteStudent(instructorUid)).rejects.toThrow();
  });
});

describe('deleteStudentAccount — full deletion, real instructor call', () => {
  it('deletes Auth account, profile, submissions, feedPosts, Storage photos, writes an audit log, and preserves every other student', async () => {
    const targetEmail = `delete-target-${Date.now()}@student.example`;
    const { backend: targetBackend, uid: targetUid, profile: targetProfile } = await createStudent(targetEmail, {
      name: '삭제될학생',
      studentId: '9990001',
    });
    await targetBackend.submitWeek(targetUid, targetProfile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '삭제 테스트용 1주차 제출입니다.' });

    // A bystander student, submitting the same week, must survive untouched.
    const { backend: bystanderBackend, uid: bystanderUid, profile: bystanderProfile } = await createStudent(
      `delete-bystander-${Date.now()}@student.example`,
      { name: '보존될학생', studentId: '9990002' },
    );
    await bystanderBackend.submitWeek(bystanderUid, bystanderProfile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '보존되어야 하는 제출입니다.' });

    const subId = `${targetUid}_${SEMESTER_ID}_w1`;
    const feedId = await feedIdFor(targetUid, 1);
    const privatePhotoPath = await submissionPhotoPath(targetUid, 1);
    const publicPhotoPath = await feedPhotoPath(targetUid, 1);

    // Sanity: everything exists before deletion.
    expect((await withRulesDisabled((db) => getDoc(doc(db, 'submissions', subId)))).exists()).toBe(true);
    expect((await withRulesDisabled((db) => getDoc(doc(db, 'feedPosts', feedId)))).exists()).toBe(true);
    await expect(withStorageRulesDisabled((storage) => getMetadata(ref(storage, privatePhotoPath)))).resolves.toBeTruthy();
    await expect(withStorageRulesDisabled((storage) => getMetadata(ref(storage, publicPhotoPath)))).resolves.toBeTruthy();

    const { backend: instructorBackend } = await createInstructor(`delete-instructor-${Date.now()}@univ.example`);
    await targetBackend.recordPrivacyConsent(targetUid, 'existing-user');
    await withRulesDisabled(db => setDoc(doc(db, 'studentIdRegistry', `${SEMESTER_ID}_9988776`), {uid:targetUid,semesterId:SEMESTER_ID,studentId:'9988776'}));
    const result = await instructorBackend.adminDeleteStudent(targetUid);
    expect(result.uid).toBe(targetUid);
    expect(result.studentId).toBe('9990001');
    expect(result.deletedWeeks).toEqual([1]);

    // Auth account is gone: signing in with the deleted account's credentials fails.
    const { FirebaseBackend } = await import('../../src/backend/firebaseBackend');
    const freshBackend = new FirebaseBackend({ useEmulator: true });
    await expect(freshBackend.signInEmail(targetEmail, 'password123')).rejects.toThrow();

    // Firestore data is gone.
    expect((await withRulesDisabled((db) => getDoc(doc(db, 'users', targetUid)))).exists()).toBe(false);
    expect((await withRulesDisabled((db) => getDoc(doc(db, 'submissions', subId)))).exists()).toBe(false);
    expect((await withRulesDisabled((db) => getDoc(doc(db, 'feedPosts', feedId)))).exists()).toBe(false);
    expect(
      (await withRulesDisabled((db) => getDoc(doc(db, 'studentIdRegistry', `${SEMESTER_ID}_9990001`)))).exists(),
    ).toBe(false);
    const goalVersions = await withRulesDisabled((db) => getDocs(collection(db, 'users', targetUid, 'goalVersions')));
    expect(goalVersions.empty).toBe(true);
    expect((await withRulesDisabled(db => getDoc(doc(db, 'users', targetUid, 'privacyConsent', 'record')))).exists()).toBe(false);
    expect((await withRulesDisabled(db => getDocs(query(collection(db, 'studentIdRegistry'), where('uid','==',targetUid))))).empty).toBe(true);

    // Storage photos are gone.
    await expect(withStorageRulesDisabled((storage) => getMetadata(ref(storage, privatePhotoPath)))).rejects.toThrow();
    await expect(withStorageRulesDisabled((storage) => getMetadata(ref(storage, publicPhotoPath)))).rejects.toThrow();

    // Audit log was written, with identifying fields only.
    const auditDocs = await withRulesDisabled((db) =>
      getDocs(query(collection(db, 'adminAuditLogs'), where('targetUid', '==', targetUid))),
    );
    expect(auditDocs.empty).toBe(false);
    const auditData = auditDocs.docs[0].data();
    expect(auditData.action).toBe('deleteStudent');
    expect(auditData.targetName).toBe('삭제될학생');
    expect(auditData.targetStudentId).toBe('9990001');
    expect(auditData.targetEmail).toBe(targetEmail);
    expect(auditData.deletedBy).toBeTruthy();
    expect(auditData.reflection).toBeUndefined();
    expect(auditData.photoURL).toBeUndefined();

    // The bystander is completely untouched.
    const bystanderProfileSnap = await withRulesDisabled((db) => getDoc(doc(db, 'users', bystanderUid)));
    expect(bystanderProfileSnap.exists()).toBe(true);
    const bystanderSubSnap = await withRulesDisabled((db) => getDoc(doc(db, 'submissions', `${bystanderUid}_${SEMESTER_ID}_w1`)));
    expect(bystanderSubSnap.exists()).toBe(true);
    const bystanderFeedId = await feedIdFor(bystanderUid, 1);
    const bystanderFeedSnap = await withRulesDisabled((db) => getDoc(doc(db, 'feedPosts', bystanderFeedId)));
    expect(bystanderFeedSnap.exists()).toBe(true);

    // The admin dashboard's own data source no longer lists the deleted student.
    const { backend: freshInstructorBackend } = await createInstructor(`delete-verify-instructor-${Date.now()}@univ.example`);
    const students = await freshInstructorBackend.adminListStudents();
    expect(students.some((s) => s.uid === targetUid)).toBe(false);
    expect(students.some((s) => s.uid === bystanderUid)).toBe(true);
  });
});

it('retries deletion after Auth succeeded but the profile/Firestore cleanup remained', async () => {
  const {uid} = await createStudent(`delete-retry-${Date.now()}@student.example`);
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key', {
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({localId:uid}),
  });
  expect(response.ok).toBe(true);
  const {backend} = await createInstructor(`delete-retry-prof-${Date.now()}@univ.example`);
  await expect(backend.adminDeleteStudent(uid)).resolves.toMatchObject({uid});
  expect((await withRulesDisabled(db => getDoc(doc(db,'users',uid)))).exists()).toBe(false);
});
