import { beforeAll, describe, expect, it } from 'vitest';
import { writeBatch, doc, Timestamp } from 'firebase/firestore';
import { FirebaseBackend } from '../../src/backend/firebaseBackend';
import { buildExcelRows } from '../../src/admin/excelExport';
import { TOTAL_WEEKS, SEMESTER_ID } from '../../src/constants';
import { getScheduledWindow } from '../../src/utils/date';
import { setupIntegrationRules, withRulesDisabled, createStudent } from './helpers';

const STUDENT_COUNT = 100;
// A realistic completion rate rather than everyone submitting every week —
// exercises the "missing week" / partial-completion paths too.
const COMPLETION_RATE = 0.85;

beforeAll(async () => {
  await setupIntegrationRules();
}, 60_000);

describe('100 students x 15 weeks (up to 1,500 submissions)', () => {
  it('seeds the roster + submissions, then measures instructor dashboard reads and Excel generation', async () => {
    // --- 1) Seed 100 student profiles + up to 1,500 submissions directly ---
    const seedStart = Date.now();
    let expectedTotalSubmissions = 0;

    await withRulesDisabled(async (db) => {
      let batch = writeBatch(db);
      let opsInBatch = 0;
      const flushIfNeeded = async () => {
        if (opsInBatch >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          opsInBatch = 0;
        }
      };

      for (let i = 0; i < STUDENT_COUNT; i++) {
        const uid = `scale-student-${i}`;
        const studentId = String(1000000 + i);
        batch.set(doc(db, 'users', uid), {
          uid, name: `학생${i}`, studentId, email: `scale${i}@student.example`,
          characterType: (['rabbit', 'fox', 'otter', 'panda'] as const)[i % 4],
          anonName: `도전자 ${i}`, role: 'student', semesterId: SEMESTER_ID, currentGoalVersion: 1,
          goalText: '도서관에서 전공책을 60분 읽고 핵심을 3줄로 정리한다.', weekday: 3, startTime: '19:00', duration: 60,
          goalCreatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
        });
        opsInBatch++;
        await flushIfNeeded();

        for (let week = 1; week <= TOTAL_WEEKS; week++) {
          // Deterministic pseudo-random completion so the test is reproducible.
          const shouldSubmit = ((i * 31 + week * 17) % 100) / 100 < COMPLETION_RATE;
          if (!shouldSubmit) continue;
          const win = getScheduledWindow(week, 3, '19:00', 60);
          const punctual = (i + week) % 3 === 0;
          const submittedDate = punctual ? new Date(win.start.getTime() + 5 * 60000) : new Date(win.end.getTime() + 3 * 3600000);
          batch.set(doc(db, 'submissions', `${uid}_${SEMESTER_ID}_w${week}`), {
            userId: uid, semesterId: SEMESTER_ID, week, goalVersion: 1,
            goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60 },
            reflection: 'x'.repeat(20), photoURL: 'https://example.com/x.jpg', photoStoragePath: '',
            submittedAt: submittedDate.toISOString(), serverCreatedAt: Timestamp.fromDate(submittedDate),
            clientPunctualClaim: punctual, status: 'submitted',
          });
          opsInBatch++;
          expectedTotalSubmissions++;
          await flushIfNeeded();
        }
      }
      if (opsInBatch > 0) await batch.commit();
    });

    const seedMs = Date.now() - seedStart;
    expect(expectedTotalSubmissions).toBeGreaterThan(STUDENT_COUNT * TOTAL_WEEKS * 0.5); // sanity: seeding actually happened at scale

    // --- 2) Real instructor account, real rules-checked reads ---
    const instructorEmail = 'scale-instructor@univ.example';
    await withRulesDisabled(async (db) => {
      const b = writeBatch(db);
      b.set(doc(db, 'instructorAllowlist', instructorEmail), { note: 'scale test' });
      await b.commit();
    });
    const instructorBackend = new FirebaseBackend({ useEmulator: true });
    await instructorBackend.signUpEmail(instructorEmail, 'password123');
    const instructorUid: string = await new Promise((resolve) => {
      const unsub = instructorBackend.onAuthChange((u) => {
        if (u) {
          unsub();
          resolve(u.uid);
        }
      });
    });
    await instructorBackend.ensureInstructorProfile(instructorUid, instructorEmail, '교수자');

    // Read + measure over WHATEVER is actually in the project (realistic —
    // a real semester's dashboard also reads every student, not a filtered
    // subset), then narrow to this test's own cohort for the correctness
    // assertions below, since other integration test files sharing this
    // same emulator project (fileParallelism:false, no clearFirestore()
    // between files, intentionally — see vitest.integration.config.ts) may
    // have created a handful of their own student accounts too.
    const readStart = Date.now();
    const [allStudents, allSubmissions] = await Promise.all([
      instructorBackend.adminListStudents(),
      instructorBackend.adminListAllSubmissions(),
    ]);
    const readMs = Date.now() - readStart;

    const isScaleCohort = (uid: string) => uid.startsWith('scale-student-');
    const students = allStudents.filter((s) => isScaleCohort(s.uid));
    const submissions = allSubmissions.filter((s) => isScaleCohort(s.userId));

    expect(allStudents.length).toBeGreaterThanOrEqual(STUDENT_COUNT);
    expect(students).toHaveLength(STUDENT_COUNT);
    expect(submissions.length).toBe(expectedTotalSubmissions);

    // --- 3) Real Excel row-building over the full dataset ---
    const excelStart = Date.now();
    const rows = buildExcelRows(allStudents, allSubmissions).filter((r) =>
      students.some((s) => s.studentId === r['학번']),
    );
    const excelMs = Date.now() - excelStart;

    expect(rows).toHaveLength(STUDENT_COUNT);
    const totalSubmittedAcrossRows = rows.reduce((sum, r) => sum + (r['총 제출 수'] as number), 0);
    expect(totalSubmittedAcrossRows).toBe(expectedTotalSubmissions);
    // Every week column must only ever be 0 or 1.
    for (const row of rows) {
      for (let w = 1; w <= TOTAL_WEEKS; w++) {
        expect([0, 1]).toContain(row[`${w}주차`]);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[scale] seed=${seedMs}ms (${expectedTotalSubmissions} submissions across ${STUDENT_COUNT} students), ` +
        `instructor dashboard read=${readMs}ms, excel build=${excelMs}ms`,
    );

    // Generous ceiling for a local emulator on a dev machine — the point is
    // catching an accidental O(n^2) or per-row-network-call regression, not
    // pinning an exact number (real Firestore over the network will differ).
    expect(readMs).toBeLessThan(20_000);
    expect(excelMs).toBeLessThan(2_000);
  }, 120_000);

  it('a single student among 100 still gets correct, isolated results (no cross-student bleed)', async () => {
    const { backend, uid } = await createStudent('scale-lone-student@student.example', { studentId: '9999999' });
    const mine = await backend.getMySubmissions(uid);
    expect(mine).toHaveLength(0); // brand new account, unaffected by the other 100 students' data
  });
});
