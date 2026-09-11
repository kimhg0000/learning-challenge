import { beforeAll, describe, expect, it } from 'vitest';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getBytes, ref, getMetadata, deleteObject } from 'firebase/storage';
import { createRequire } from 'node:module';
const sharp = createRequire(new URL('../../functions/package.json', import.meta.url))('sharp');
import { FirebaseBackend } from '../../src/backend/firebaseBackend';
import { SEMESTER_ID } from '../../src/constants';
import { setupIntegrationRules, createStudent, withRulesDisabled, withStorageRulesDisabled, sha256Hex, tinyJpegBlob } from './helpers';

// Exercises the REAL publishFeedPost Cloud Function directly (via
// FirebaseBackend.callPublishFeedPost — a test-only wrapper, see its doc
// comment), running against the real Functions emulator — see package.json
// "integration:test". This is the function submitWeek() calls internally
// (through publishFeedWithRetry, unit-tested separately for its bounded
// retry / never-throw behavior); these tests instead pin down the
// function's own auth, ownership, and idempotency guarantees in isolation.

beforeAll(async () => {
  await setupIntegrationRules();
});

describe('publishFeedPost — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const backend = new FirebaseBackend({ useEmulator: true });
    await expect(backend.callPublishFeedPost(1)).rejects.toThrow();
  });

  it('rejects when the caller has no submission for that week yet', async () => {
    const { backend } = await createStudent('publish-no-submission@student.example');
    await expect(backend.callPublishFeedPost(1)).rejects.toThrow();
  });

  it('rejects when the submission at the caller\'s own derived id belongs to a different uid (tampered data)', async () => {
    const { backend, uid, profile } = await createStudent('publish-owner-check@student.example');
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '소유자 검증용 제출입니다.' });

    const subId = `${uid}_${SEMESTER_ID}_w1`;
    await withRulesDisabled((db) => updateDoc(doc(db, 'submissions', subId), { userId: 'someone-else-entirely' }));

    await expect(backend.callPublishFeedPost(1)).rejects.toThrow();
  });

  it('rejects when the submission\'s recorded photoStoragePath does not match the caller\'s own expected private path', async () => {
    const { backend, uid, profile } = await createStudent('publish-path-check@student.example');
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '경로 검증용 제출입니다.' });

    const subId = `${uid}_${SEMESTER_ID}_w1`;
    await withRulesDisabled((db) => updateDoc(doc(db, 'submissions', subId), { photoStoragePath: 'submissions/someone-else/other/week1.jpg' }));

    await expect(backend.callPublishFeedPost(1)).rejects.toThrow();
  });
});

describe('publishFeedPost — server-side copy, schema, and idempotency', () => {
  it('feedId is sha256(subId) — identical to the existing client-side derivation deleteStudentAccount still relies on', async () => {
    const { backend, uid, profile } = await createStudent('publish-feedid@student.example');
    // submitWeek() already calls publishFeedPost internally (via the bounded
    // retry) — read back what it produced rather than double-publishing.
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: 'feedId 파생 검증용 제출입니다.' });

    const subId = `${uid}_${SEMESTER_ID}_w1`;
    const expectedFeedId = await sha256Hex(subId);
    const feedSnap = await withRulesDisabled((db) => getDoc(doc(db, 'feedPosts', expectedFeedId)));
    expect(feedSnap.exists()).toBe(true);
  });

  it('preserves private bytes and produces a JPEG thumbnail at the compatible path', async () => {
    const { backend, uid, profile } = await createStudent('publish-storage-copy@student.example');
    const photo = tinyJpegBlob();
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: photo, reflection: 'Storage 복사 검증용 제출입니다.' });

    const subId = `${uid}_${SEMESTER_ID}_w1`;
    const feedId = await sha256Hex(subId);
    const copiedBytes = await withStorageRulesDisabled((storage) => getBytes(ref(storage, `feedPhotos/${feedId}.jpg`)));
    const originalBytes = new Uint8Array(await photo.arrayBuffer());
    const privateBytes = await withStorageRulesDisabled(storage => getBytes(ref(storage, `submissions/${uid}/${SEMESTER_ID}/week1.jpg`)));
    expect(new Uint8Array(privateBytes)).toEqual(originalBytes);
    const meta = await sharp(Buffer.from(copiedBytes)).metadata();
    expect(meta.format).toBe('jpeg'); expect(meta.width).toBeLessThanOrEqual(1200);
    const stored = await withStorageRulesDisabled(storage => getMetadata(ref(storage, `feedPhotos/${feedId}.jpg`)));
    expect(stored.contentType).toBe('image/jpeg');
  });

  it('the written feedPosts document contains no uid/name/studentId/email — exactly the existing anonymous schema', async () => {
    const { backend, uid, profile } = await createStudent('publish-pii-check@student.example');
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: 'PII 검증용 제출입니다.' });

    const subId = `${uid}_${SEMESTER_ID}_w1`;
    const feedId = await sha256Hex(subId);
    const feedSnap = await withRulesDisabled((db) => getDoc(doc(db, 'feedPosts', feedId)));
    expect(feedSnap.exists()).toBe(true);
    const data = feedSnap.data()!;
    expect(Object.keys(data).sort()).toEqual(
      ['anonName', 'characterStage', 'characterType', 'createdAt', 'photoURL', 'punctualClaim', 'reflection', 'semesterId', 'week'].sort(),
    );
    expect(data.uid).toBeUndefined();
    expect(data.name).toBeUndefined();
    expect(data.studentId).toBeUndefined();
    expect(data.email).toBeUndefined();
  });

  it('calling publishFeedPost again for an already-published week is idempotent: same feedId/photoURL, no duplicate write', async () => {
    const { backend, uid, profile } = await createStudent('publish-idempotent@student.example');
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '멱등성 검증용 제출입니다.' });

    const first = await backend.callPublishFeedPost(1);
    const second = await backend.callPublishFeedPost(1);
    expect(second.feedId).toBe(first.feedId);
    expect(second.photoURL).toBe(first.photoURL);

    const feedId = await sha256Hex(`${uid}_${SEMESTER_ID}_w1`);
    const feedSnap = await withRulesDisabled((db) => getDoc(doc(db, 'feedPosts', feedId)));
    expect(feedSnap.exists()).toBe(true);
  });
});

describe('publish concurrency and failure isolation', () => {
  it('concurrent first publishes and retry converge on one immutable token/object', async () => {
    const { backend, uid, profile } = await createStudent('publish-concurrent@student.example');
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '동시 호출 테스트 제출입니다.' });
    const feedId = await sha256Hex(`${uid}_${SEMESTER_ID}_w1`);
    // Disposable emulator fixture: remove the generated output, preserving the
    // committed private submission, so calls race through actual creation.
    const { deleteDoc } = await import('firebase/firestore');
    await withRulesDisabled(db => deleteDoc(doc(db, 'feedPosts', feedId)));
    await withStorageRulesDisabled(storage => deleteObject(ref(storage, `feedPhotos/${feedId}.jpg`)));
    const results = await Promise.all(Array.from({ length: 5 }, () => backend.callPublishFeedPost(1)));
    expect(new Set(results.map(r => r.photoURL)).size).toBe(1);
    const before = await withStorageRulesDisabled(storage => getMetadata(ref(storage, `feedPhotos/${feedId}.jpg`)));
    const response = await fetch(results[0].photoURL);
    expect(response.ok).toBe(true); expect(response.headers.get('content-type')).toContain('image/jpeg');
    await backend.callPublishFeedPost(1);
    const after = await withStorageRulesDisabled(storage => getMetadata(ref(storage, `feedPhotos/${feedId}.jpg`)));
    expect(after.generation).toBe(before.generation);
    // Simulate Firestore commit failure after successful Storage write.
    await withRulesDisabled(db => deleteDoc(doc(db, 'feedPosts', feedId)));
    const retry = await backend.callPublishFeedPost(1);
    expect(retry.photoURL).toBe(results[0].photoURL);
    expect((await withStorageRulesDisabled(storage => getMetadata(ref(storage, `feedPhotos/${feedId}.jpg`)))).generation).toBe(before.generation);
  });
  it('corrupt input preserves the successful private submission and never publishes the original', async () => {
    const { backend, uid, profile } = await createStudent('publish-corrupt@student.example');
    const blob = new Blob([new Uint8Array([255,216,255,217])], {type:'image/jpeg'});
    const sub = await backend.submitWeek(uid, profile, { week: 1, photoBlob: blob, reflection:'손상된 사진 실패 격리 테스트입니다.' });
    expect(sub.status).toBe('submitted');
    const feedId = await sha256Hex(sub.id);
    expect((await withRulesDisabled(db => getDoc(doc(db, 'submissions', sub.id)))).exists()).toBe(true);
    expect((await withRulesDisabled(db => getDoc(doc(db, 'feedPosts', feedId)))).exists()).toBe(false);
    await expect(withStorageRulesDisabled(storage => getMetadata(ref(storage, `feedPhotos/${feedId}.jpg`)))).rejects.toThrow();
  });
});
