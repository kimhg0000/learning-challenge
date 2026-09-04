import { beforeAll, describe, expect, it } from 'vitest';
import { setupIntegrationRules, createStudent, tinyJpegBlob } from './helpers';

beforeAll(async () => {
  await setupIntegrationRules();
});

describe('FirebaseBackend.updateProfile()', () => {
  it('corrects name/studentId, leaves goal/character untouched, and records a history entry', async () => {
    const { backend, uid, profile } = await createStudent('profile-edit-a@student.example', { studentId: '1112223' });
    const updated = await backend.updateProfile(uid, { name: '새이름', studentId: '3332221' });

    expect(updated.name).toBe('새이름');
    expect(updated.studentId).toBe('3332221');
    expect(updated.characterType).toBe(profile.characterType);
    expect(updated.goalText).toBe(profile.goalText);

    const history = await backend.getProfileHistory(uid);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      previousName: profile.name, newName: '새이름',
      previousStudentId: '1112223', newStudentId: '3332221',
    });
  });

  it('rejects changing to a studentId another student in the same semester already has', async () => {
    await createStudent('profile-edit-taken@student.example', { studentId: '4445556' });
    const { backend, uid } = await createStudent('profile-edit-b@student.example', { studentId: '5556667' });

    await expect(backend.updateProfile(uid, { name: '학생비', studentId: '4445556' })).rejects.toThrow();

    // The rejected attempt must not have partially applied.
    const stillProfile = await backend.getProfile(uid);
    expect(stillProfile?.studentId).toBe('5556667');
  });

  it('is a no-op (no history entry) when neither name nor studentId actually changed', async () => {
    const { backend, uid, profile } = await createStudent('profile-edit-c@student.example');
    await backend.updateProfile(uid, { name: profile.name, studentId: profile.studentId });
    expect(await backend.getProfileHistory(uid)).toHaveLength(0);
  });

  it('never alters an already-submitted week\'s photo/reflection/goalSnapshot/submittedAt when the name and studentId are later edited', async () => {
    // Submission documents never store name/studentId at all (identity is
    // resolved from userId -> profile at display/export time, which is also
    // what keeps the student feed anonymous) — so the thing a profile edit
    // could actually corrupt is the submission's own content snapshot.
    const { backend, uid, profile } = await createStudent('profile-edit-snapshot@student.example', { studentId: '6667778' });
    const before = await backend.submitWeek(uid, profile, {
      week: 1,
      photoBlob: tinyJpegBlob(),
      reflection: '수정 전 이름/학번으로 제출한 원본 성찰입니다.',
    });

    await backend.updateProfile(uid, { name: '수정된이름', studentId: '8889990' });

    const [after] = await backend.getMySubmissions(uid);
    expect(after.week).toBe(1);
    expect(after.reflection).toBe(before.reflection);
    expect(after.photoURL).toBe(before.photoURL);
    expect(after.photoStoragePath).toBe(before.photoStoragePath);
    expect(after.submittedAt).toBe(before.submittedAt);
    expect(after.goalSnapshot).toEqual(before.goalSnapshot);
    expect(after.status).toBe(before.status);
  });
});
