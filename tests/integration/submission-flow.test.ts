import { beforeAll, describe, expect, it } from 'vitest';
import { SubmissionExistsError } from '../../src/backend/firebaseBackend';
import { setupIntegrationRules, createStudent, tinyJpegBlob, oversizedNonImageBlob } from './helpers';

beforeAll(async () => {
  await setupIntegrationRules();
});

describe('duplicate submission / idempotency (real FirebaseBackend, real emulator)', () => {
  it('double-click race: two concurrent submitWeek() calls for the same week never both succeed', async () => {
    const { backend, uid, profile } = await createStudent('race-test@student.example');

    const [a, b] = await Promise.allSettled([
      backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '첫 번째 제출 시도입니다.' }),
      backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '두 번째 제출 시도입니다.' }),
    ]);

    const outcomes = [a, b];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser can surface either our own SubmissionExistsError (its
    // transaction retried after contention and then saw the doc already
    // there) or a raw Firestore permission-denied (the rules' own
    // !exists() check won the race at commit time instead) — both are
    // correct outcomes of the SAME guarantee. What actually matters for
    // data integrity is asserted below: exactly one document ends up
    // stored for this student+week, never zero or two.

    const stored = await backend.getMySubmissions(uid);
    expect(stored.filter((s) => s.week === 1)).toHaveLength(1);
  });

  it('a straightforward second submitWeek() call after a successful one is rejected, not silently duplicated', async () => {
    const { backend, uid, profile } = await createStudent('resubmit-test@student.example');
    await backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '정상적으로 제출했습니다.' });

    await expect(
      backend.submitWeek(uid, profile, { week: 1, photoBlob: tinyJpegBlob(), reflection: '실수로 다시 눌렀습니다.' }),
    ).rejects.toBeInstanceOf(SubmissionExistsError);

    const stored = await backend.getMySubmissions(uid);
    expect(stored.filter((s) => s.week === 1)).toHaveLength(1);
    expect(stored.find((s) => s.week === 1)?.reflection).toBe('정상적으로 제출했습니다.');
  });
});

describe('photo upload failure never leaves an orphan/broken submission record', () => {
  it('an upload rejected by storage.rules (oversized/non-image) leaves NO Firestore submission document at all', async () => {
    const { backend, uid, profile } = await createStudent('upload-fail-test@student.example');

    await expect(
      backend.submitWeek(uid, profile, { week: 1, photoBlob: oversizedNonImageBlob(), reflection: '이 제출은 실패해야 합니다.' }),
    ).rejects.toThrow();

    const stored = await backend.getMySubmissions(uid);
    expect(stored).toHaveLength(0);
  });

  it('after a failed upload, the student can immediately retry and succeed for the same week', async () => {
    const { backend, uid, profile } = await createStudent('upload-retry-test@student.example');

    await expect(
      backend.submitWeek(uid, profile, { week: 1, photoBlob: oversizedNonImageBlob(), reflection: '이 제출은 실패해야 합니다.' }),
    ).rejects.toThrow();

    const retried = await backend.submitWeek(uid, profile, {
      week: 1,
      photoBlob: tinyJpegBlob(),
      reflection: '재시도로 성공한 제출입니다.',
    });
    expect(retried.week).toBe(1);

    const stored = await backend.getMySubmissions(uid);
    expect(stored.filter((s) => s.week === 1)).toHaveLength(1);
  });
});
