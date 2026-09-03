import { describe, expect, it } from 'vitest';
import { buildInstructorFeedItems } from '../../src/utils/instructorFeed';
import type { Submission, UserProfile } from '../../src/types';

function student(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'u1', name: '김철수', studentId: '2071001', email: 'a@example.com',
    characterType: 'rabbit', anonName: '도전자 1', role: 'student', semesterId: 'sem',
    currentGoalVersion: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60,
    goalCreatedAt: '', updatedAt: '', createdAt: '',
    ...overrides,
  };
}

function sub(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'x', userId: 'u1', semesterId: 'sem', week: 1, goalVersion: 1,
    goalSnapshot: { version: 1, goalText: 'x', weekday: 3, startTime: '19:00', duration: 60 },
    reflection: 'r', photoURL: 'https://example.com/1.jpg', photoStoragePath: 'p',
    submittedAt: '2026-09-01T00:00:00.000Z', serverCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
    clientPunctualClaim: false, status: 'submitted',
    ...overrides,
  };
}

describe('buildInstructorFeedItems', () => {
  const students = [
    student({ uid: 'u1', name: '김철수', studentId: '2071001' }),
    student({ uid: 'u2', name: '박영희', studentId: '2071002' }),
  ];

  it('joins each submission with its student name/studentId — never anonName', () => {
    const subs = [sub({ userId: 'u1', week: 1 })];
    const items = buildInstructorFeedItems(students, subs, { week: 0, query: '' });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('김철수');
    expect(items[0].studentId).toBe('2071001');
  });

  it('week=0 (전체) returns every student\'s submissions; a specific week filters to just that week', () => {
    const subs = [sub({ userId: 'u1', week: 1 }), sub({ userId: 'u1', week: 2 }), sub({ userId: 'u2', week: 1 })];
    expect(buildInstructorFeedItems(students, subs, { week: 0, query: '' })).toHaveLength(3);
    expect(buildInstructorFeedItems(students, subs, { week: 1, query: '' })).toHaveLength(2);
    expect(buildInstructorFeedItems(students, subs, { week: 2, query: '' })).toHaveLength(1);
  });

  it('a name search returns only that student\'s submissions, regardless of week filter', () => {
    const subs = [sub({ userId: 'u1', week: 1 }), sub({ userId: 'u1', week: 3 }), sub({ userId: 'u2', week: 1 })];
    const all = buildInstructorFeedItems(students, subs, { week: 0, query: '김철수' });
    expect(all).toHaveLength(2);
    expect(all.every((i) => i.name === '김철수')).toBe(true);

    const weekAndName = buildInstructorFeedItems(students, subs, { week: 1, query: '김철수' });
    expect(weekAndName).toHaveLength(1);
    expect(weekAndName[0].submission.week).toBe(1);
  });

  it('a studentId search matches by id too', () => {
    const subs = [sub({ userId: 'u1' }), sub({ userId: 'u2' })];
    const items = buildInstructorFeedItems(students, subs, { week: 0, query: '2071002' });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('박영희');
  });

  it('an unmatched search returns an empty list, not an error', () => {
    const subs = [sub({ userId: 'u1' })];
    expect(buildInstructorFeedItems(students, subs, { week: 0, query: '없는학생' })).toHaveLength(0);
  });

  it('with a search query, results are ordered by week ascending (a student\'s own journey in order)', () => {
    const subs = [sub({ userId: 'u1', week: 5 }), sub({ userId: 'u1', week: 1 }), sub({ userId: 'u1', week: 3 })];
    const items = buildInstructorFeedItems(students, subs, { week: 0, query: '김철수' });
    expect(items.map((i) => i.submission.week)).toEqual([1, 3, 5]);
  });

  it('with no search query, results are ordered by submission time, most recent first', () => {
    const subs = [
      sub({ userId: 'u1', week: 1, submittedAt: '2026-09-01T00:00:00.000Z' }),
      sub({ userId: 'u2', week: 1, submittedAt: '2026-09-03T00:00:00.000Z' }),
    ];
    const items = buildInstructorFeedItems(students, subs, { week: 0, query: '' });
    expect(items.map((i) => i.uid)).toEqual(['u2', 'u1']);
  });
});
