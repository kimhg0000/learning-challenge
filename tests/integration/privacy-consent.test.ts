import { beforeAll, describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_VERSION } from '../../src/config/privacy';
import { needsPrivacyConsent } from '../../src/utils/privacyConsent';
import { setupIntegrationRules, createStudent, createInstructor } from './helpers';

beforeAll(async () => {
  await setupIntegrationRules();
});

describe('FirebaseBackend privacy consent', () => {
  it('a brand-new student has no consent record until recordPrivacyConsent() is called', async () => {
    const { backend, uid } = await createStudent('privacy-new-a@student.example');
    expect(await backend.getPrivacyConsent(uid)).toBeNull();

    const consent = await backend.recordPrivacyConsent(uid, 'signup');
    expect(consent.agreed).toBe(true);
    expect(consent.version).toBe(PRIVACY_POLICY_VERSION);
    expect(consent.source).toBe('signup');

    const reread = await backend.getPrivacyConsent(uid);
    expect(reread).toMatchObject({ agreed: true, version: PRIVACY_POLICY_VERSION, source: 'signup' });
  });

  it('agreedAt is a real server timestamp, never the wall-clock instant the client called recordPrivacyConsent()', async () => {
    const { backend, uid } = await createStudent('privacy-new-b@student.example');
    const before = Date.now();
    await backend.recordPrivacyConsent(uid, 'signup');
    const after = Date.now();

    const consent = await backend.getPrivacyConsent(uid);
    const agreedAtMs = new Date(consent!.agreedAt).getTime();
    expect(agreedAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(agreedAtMs).toBeLessThanOrEqual(after + 1000);
  });

  it('an existing account with completed onboarding but no consent record still needs consent (never auto-agreed)', async () => {
    const { backend, uid } = await createStudent('privacy-existing-a@student.example');
    // completeOnboarding() (already called by createStudent) never touches
    // privacyConsent — this is the exact scenario a real pre-existing
    // student account is in.
    const consent = await backend.getPrivacyConsent(uid);
    expect(needsPrivacyConsent(consent, PRIVACY_POLICY_VERSION)).toBe(true);

    await backend.recordPrivacyConsent(uid, 'existing-user');
    const afterConsent = await backend.getPrivacyConsent(uid);
    expect(needsPrivacyConsent(afterConsent, PRIVACY_POLICY_VERSION)).toBe(false);
    expect(afterConsent!.source).toBe('existing-user');
  });

  it('re-recording consent overwrites the record (current-status-only, no history kept)', async () => {
    const { backend, uid } = await createStudent('privacy-reconsent@student.example');
    await backend.recordPrivacyConsent(uid, 'signup');
    const first = await backend.getPrivacyConsent(uid);

    await new Promise((r) => setTimeout(r, 50));
    await backend.recordPrivacyConsent(uid, 'existing-user');
    const second = await backend.getPrivacyConsent(uid);

    expect(second!.source).toBe('existing-user');
    expect(new Date(second!.agreedAt).getTime()).toBeGreaterThanOrEqual(new Date(first!.agreedAt).getTime());
  });

  it('a student cannot read or write another student\'s consent record via the real backend', async () => {
    const { uid: uidA } = await createStudent('privacy-owner-a@student.example');
    const { backend: backendB } = await createStudent('privacy-owner-b@student.example');

    await expect(backendB.getPrivacyConsent(uidA)).rejects.toThrow();
    await expect(backendB.recordPrivacyConsent(uidA, 'signup')).rejects.toThrow();
  });

  it('an instructor can read a student\'s consent status (both before and after the student consents); the student sees the same record', async () => {
    const { backend: studentBackend, uid } = await createStudent('privacy-admin-view@student.example');
    const { backend: instructorBackend } = await createInstructor('privacy-instructor@univ.example');

    expect(await instructorBackend.adminGetPrivacyConsent(uid)).toBeNull();

    await studentBackend.recordPrivacyConsent(uid, 'signup');

    const viaInstructor = await instructorBackend.adminGetPrivacyConsent(uid);
    const viaStudent = await studentBackend.getPrivacyConsent(uid);
    expect(viaInstructor).toMatchObject({ agreed: true, version: PRIVACY_POLICY_VERSION, source: 'signup' });
    expect(viaInstructor).toEqual(viaStudent);
  });

  it('an instructor cannot record consent on a student\'s behalf', async () => {
    const { uid } = await createStudent('privacy-instructor-cannot-consent@student.example');
    const { backend: instructorBackend } = await createInstructor('privacy-instructor-2@univ.example');
    await expect(instructorBackend.recordPrivacyConsent(uid, 'existing-user')).rejects.toThrow();
  });
});
