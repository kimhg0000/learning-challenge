import { beforeAll, describe, expect, it } from 'vitest';
import { doc, updateDoc } from 'firebase/firestore';
import { setupIntegrationRules, createStudent, withRulesDisabled, tinyJpegBlob } from './helpers';
import { SEMESTER_ID } from '../../src/constants';

// Regression coverage for the 2026-09 staging bug report: the instructor
// dashboard and Excel export showed 2 submissions for a week, but the
// anonymous feed showed 0 for the same week — because the E2E seed script
// wrote `submissions` docs directly and skipped `feedPosts` entirely,
// something the real FirebaseBackend.submitWeek() never does. These tests
// exercise the REAL submitWeek() path (not raw seeding) and assert the
// invariant the user explicitly asked for: for any given week, the number
// of private submissions and the number of public feed posts must match.

beforeAll(async () => {
  await setupIntegrationRules();
});

// listFeed() queries the whole feedPosts collection for a week, and this
// integration suite runs many test files against the SAME shared emulator
// project in one `firebase emulators:exec` session — so other files' week-1
// submissions land in the same query results. Every test below uses a
// reflection string unique to itself and filters by it, rather than
// asserting on the raw collection length, to stay correct regardless of
// what else the full suite has already submitted for that week.

describe('private submission / public feed count consistency', () => {
  it('N students submitting the same week produce exactly N anonymous feed posts for that week', async () => {
    const a = await createStudent('feed-consistency-a@student.example');
    const b = await createStudent('feed-consistency-b@student.example');
    const markerA = `[marker-a-${Date.now()}] 학생 A의 1주차 성찰입니다.`;
    const markerB = `[marker-b-${Date.now()}] 학생 B의 1주차 성찰입니다.`;

    await a.backend.submitWeek(a.uid, a.profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: markerA });
    await b.backend.submitWeek(b.uid, b.profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: markerB });

    const feed = await a.backend.listFeed(1);
    expect(feed.filter((f) => f.reflection === markerA || f.reflection === markerB)).toHaveLength(2);
  });

  it('one student submitting two different weeks produces exactly one feed post per week — never zero, never duplicated', async () => {
    const { backend, uid, profile } = await createStudent('feed-consistency-c@student.example');
    const markerWeek1 = `[marker-w1-${Date.now()}] 1주차 성찰입니다.`;
    const markerWeek2 = `[marker-w2-${Date.now()}] 2주차 성찰입니다.`;

    // The client-side submission-window pre-check uses the fixed test clock
    // setupIntegrationRules() sets (inside week 1's real window) — advance it
    // into week 2's window for the second submission, then restore it, so
    // later tests in this file/worker are unaffected.
    const originalNow = globalThis.__QUEST_TEST_NOW;
    try {
      await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: markerWeek1 });
      globalThis.__QUEST_TEST_NOW = '2026-09-16T12:00:00+09:00'; // week 2
      await backend.submitWeek(uid, profile, { week: 2, photoBlob: tinyJpegBlob(), reflection: markerWeek2 });
    } finally {
      globalThis.__QUEST_TEST_NOW = originalNow;
    }

    const feedWeek1 = await backend.listFeed(1);
    const feedWeek2 = await backend.listFeed(2);
    expect(feedWeek1.filter((f) => f.reflection === markerWeek1)).toHaveLength(1);
    expect(feedWeek2.filter((f) => f.reflection === markerWeek2)).toHaveLength(1);
  });
});

describe('deterministic feed id', () => {
  it('the feed post id is derived from the submission id, not random, and never equals or contains the raw uid', async () => {
    const { backend, uid, profile } = await createStudent('feed-id-test@student.example');
    const marker = `[marker-id-${Date.now()}] 테스트 제출입니다.`;
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: marker });

    const feed = await backend.listFeed(1);
    const mine = feed.filter((f) => f.reflection === marker);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).not.toBe(uid);
    expect(mine[0].id.includes(uid)).toBe(false);
  });
});

describe('feed-step failure never blocks or corrupts the private submission', () => {
  it('an inconsistent stored profile is now rejected by submission integrity rules', async () => {
    // publishFeedPost (functions/src/index.ts) re-derives semesterId from the
    // caller's OWN stored profile document, never a client-supplied value —
    // A profile/semester mismatch now also prevents committing the private
    // submission. Restoring that profile must allow retry with the original
    // immutable upload, without uploading/replacing that photo again.
    const { backend, uid, profile } = await createStudent('feed-retry-fail@student.example');
    await withRulesDisabled((db) => updateDoc(doc(db, 'users', uid), { semesterId: '' }));

    await expect(backend.submitWeek(uid, profile, {
      week: 1,
      photoBlob: tinyJpegBlob(),
      reflection: '피드가 실패해도 제출은 성공해야 합니다.',
    })).rejects.toThrow();

    const stored = await backend.getMySubmissions(uid);
    expect(stored.filter((s) => s.week === 1)).toHaveLength(0);

    const feed = await backend.listFeed(1);
    expect(feed.filter((f) => f.reflection === '피드가 실패해도 제출은 성공해야 합니다.')).toHaveLength(0);
    const {withStorageRulesDisabled}=await import('./helpers');
    const {getMetadata,ref}=await import('firebase/storage');
    const path=`submissions/${uid}/${SEMESTER_ID}/week1.jpg`;
    const original=await withStorageRulesDisabled(storage=>getMetadata(ref(storage,path)));
    await withRulesDisabled(db=>updateDoc(doc(db,'users',uid),{semesterId:SEMESTER_ID}));
    await backend.submitWeek(uid,profile,{week:1,photoBlob:tinyJpegBlob(),reflection:'동일 원본을 덮어쓰지 않고 제출 저장만 재시도합니다.'});
    const retried=await withStorageRulesDisabled(storage=>getMetadata(ref(storage,path)));
    expect(retried.generation).toBe(original.generation);
  }, 15000);
});
