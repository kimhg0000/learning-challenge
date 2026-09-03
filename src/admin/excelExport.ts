import { TOTAL_WEEKS } from '../constants';
import { isPunctualSubmission } from '../utils/punctual';
import type { Submission, UserProfile } from '../types';

export type ExcelRow = Record<string, string | number>;

/**
 * Pure row-building logic, kept separate from the SheetJS/file-writing call
 * so it can be unit tested without a browser or a real xlsx dependency.
 * De-duplicates by (uid, week) so a stray duplicate submission document can
 * never inflate a student's counted weeks past 1 per week.
 */
export function buildExcelRows(students: UserProfile[], submissions: Submission[]): ExcelRow[] {
  const byStudent = new Map<string, Submission[]>();
  for (const sub of submissions) {
    const list = byStudent.get(sub.userId) ?? [];
    // De-dupe by week: keep at most one submission per week per student.
    if (!list.some((s) => s.week === sub.week)) list.push(sub);
    byStudent.set(sub.userId, list);
  }

  return [...students]
    .sort((a, b) => a.studentId.localeCompare(b.studentId))
    .map((student) => {
      const subs = byStudent.get(student.uid) ?? [];
      const weekCols: ExcelRow = {};
      for (let w = 1; w <= TOTAL_WEEKS; w++) {
        weekCols[`${w}주차`] = subs.some((s) => s.week === w) ? 1 : 0;
      }
      const punctualCount = subs.filter((s) => isPunctualSubmission(s)).length;
      return {
        이름: student.name,
        학번: student.studentId,
        ...weekCols,
        '총 제출 수': subs.length,
        '정시 제출 수': punctualCount,
      };
    });
}

export async function downloadSemesterExcel(students: UserProfile[], submissions: Submission[]): Promise<void> {
  const rows = buildExcelRows(students, submissions);
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '15주 챌린지');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `15week-challenge-${stamp}.xlsx`);
}
