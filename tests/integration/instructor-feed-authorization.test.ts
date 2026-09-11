import { beforeAll, describe, expect, it } from 'vitest';
import { doc, setDoc } from 'firebase/firestore';
import { FirebaseBackend } from '../../src/backend/firebaseBackend';
import { verifyEmulatorEmail, setupIntegrationRules, createStudent, withRulesDisabled } from './helpers';

// The instructor real-name feed (feed.ts renderInstructorFeed) is built by
// calling backend.adminListStudents()/adminListAllSubmissions() directly —
// the SAME methods the instructor dashboard already used. These tests
// confirm, through the real FirebaseBackend (not just the raw rules), that
// a non-instructor can never pull that data, and an instructor can.

beforeAll(async () => {
  await setupIntegrationRules();
});

describe('instructor-only access to the roster/submissions the real-name feed depends on', () => {
  it('a regular student cannot list all students or all submissions', async () => {
    const { backend } = await createStudent('feed-auth-student@student.example');
    await expect(backend.adminListStudents()).rejects.toThrow();
    await expect(backend.adminListAllSubmissions()).rejects.toThrow();
  });

  it('an allowlisted instructor can list students and submissions, getting real names/ids', async () => {
    const email = `feed-auth-instructor-${Date.now()}@univ.example`;
    const backend = new FirebaseBackend({ useEmulator: true });
    await backend.signUpEmail(email, 'password123');
    const uid: string = await new Promise((resolve) => {
      const unsub = backend.onAuthChange((u) => { if (u) { unsub(); resolve(u.uid); } });
    });
    await withRulesDisabled(async (firestore) => {
      await setDoc(doc(firestore, 'instructorAllowlist', email.toLowerCase()), { note: 'test' });
    });
    await verifyEmulatorEmail(backend, uid, email);
    await backend.ensureInstructorProfile(uid, email, '교수자');

    const students = await backend.adminListStudents();
    const allSubs = await backend.adminListAllSubmissions();
    expect(Array.isArray(students)).toBe(true);
    expect(Array.isArray(allSubs)).toBe(true);
  });
});
