import { beforeAll, describe, expect, it } from 'vitest';
import { setupIntegrationRules, createStudent } from './helpers';

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
});
