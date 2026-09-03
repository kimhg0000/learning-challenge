import { describe, expect, it } from 'vitest';
import {
  isValidCharacterType,
  isValidDuration,
  isValidGoalSettings,
  isValidGoalText,
  isValidName,
  isValidReflection,
  isValidStudentId,
} from '../../src/utils/validation';

describe('isValidStudentId', () => {
  it('accepts exactly 7 digits', () => expect(isValidStudentId('1234567')).toBe(true));
  it('rejects 6 digits', () => expect(isValidStudentId('123456')).toBe(false));
  it('rejects 8 digits', () => expect(isValidStudentId('12345678')).toBe(false));
  it('rejects non-numeric characters', () => expect(isValidStudentId('123456a')).toBe(false));
  it('rejects empty/undefined', () => {
    expect(isValidStudentId('')).toBe(false);
    // @ts-expect-error intentionally testing runtime guard against undefined
    expect(isValidStudentId(undefined)).toBe(false);
  });
});

describe('isValidName', () => {
  it('requires at least 2 trimmed characters', () => {
    expect(isValidName('김')).toBe(false);
    expect(isValidName('김한')).toBe(true);
    expect(isValidName('  김  ')).toBe(false);
  });
});

describe('isValidCharacterType', () => {
  it('accepts the four defined characters only', () => {
    expect(isValidCharacterType('rabbit')).toBe(true);
    expect(isValidCharacterType('dragon')).toBe(false);
    expect(isValidCharacterType(undefined)).toBe(false);
  });
});

describe('isValidGoalText', () => {
  it('rejects vague non-behavioral goals that are too short', () => {
    expect(isValidGoalText('공부 열심히 하기')).toBe(false); // 8 chars after trim
  });
  it('accepts a concrete behavioral goal', () => {
    expect(isValidGoalText('도서관에서 전공책을 60분 읽고 핵심 내용을 3줄로 정리한다.')).toBe(true);
  });
});

describe('isValidReflection', () => {
  it('requires at least 10 characters', () => {
    expect(isValidReflection('짧음')).toBe(false);
    expect(isValidReflection('오늘도 계획대로 잘 실천했다.')).toBe(true);
  });
});

describe('isValidDuration', () => {
  it('accepts only the defined options up to 120 minutes', () => {
    expect(isValidDuration(60)).toBe(true);
    expect(isValidDuration(120)).toBe(true);
    expect(isValidDuration(150)).toBe(false);
    expect(isValidDuration(61)).toBe(false); // not one of the offered options
  });
});

describe('isValidGoalSettings', () => {
  it('requires goal text, weekday, start time, and a valid duration together', () => {
    expect(
      isValidGoalSettings({ goalText: '도서관에서 60분 읽고 요약한다', weekday: 2, startTime: '19:00', duration: 60 }),
    ).toBe(true);
    expect(isValidGoalSettings({ goalText: '도서관에서 60분 읽고 요약한다', weekday: undefined, startTime: '19:00', duration: 60 })).toBe(
      false,
    );
  });
});
