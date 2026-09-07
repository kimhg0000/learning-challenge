import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '../../src/utils/authErrors';

describe('authErrorMessage', () => {
  it('signup: an email already registered (partial signup or otherwise) tells the user to log in instead, not a generic "wrong password" message', () => {
    expect(authErrorMessage('signup', 'auth/email-already-in-use')).toBe('이미 가입된 이메일입니다. 로그인해 주세요.');
  });

  it('signup: invalid email format gets its own message', () => {
    expect(authErrorMessage('signup', 'auth/invalid-email')).toBe('올바른 이메일 형식이 아닙니다.');
  });

  it('signup: weak password gets its own message', () => {
    expect(authErrorMessage('signup', 'auth/weak-password')).toBe('비밀번호는 6자 이상이어야 합니다.');
  });

  it('signup: an unrecognized/unexpected code falls back to a signup-specific generic message', () => {
    expect(authErrorMessage('signup', 'auth/network-request-failed')).toBe('회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.');
    expect(authErrorMessage('signup', undefined)).toBe('회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.');
  });

  it('login: wrong credentials (any of the Firebase code variants) get a login-specific message', () => {
    expect(authErrorMessage('login', 'auth/wrong-password')).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
    expect(authErrorMessage('login', 'auth/user-not-found')).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
    expect(authErrorMessage('login', 'auth/invalid-credential')).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });

  it('login: invalid email format gets its own message', () => {
    expect(authErrorMessage('login', 'auth/invalid-email')).toBe('올바른 이메일 형식이 아닙니다.');
  });

  it('login: an unrecognized/unexpected code falls back to the existing generic login message', () => {
    expect(authErrorMessage('login', 'auth/network-request-failed')).toBe('로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.');
    expect(authErrorMessage('login', undefined)).toBe('로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.');
  });

  it('an unrecognized error code produces DIFFERENT fallback messages for signup vs. login — proving the two are no longer conflated behind one generic string', () => {
    expect(authErrorMessage('signup', undefined)).not.toBe(authErrorMessage('login', undefined));
  });
});
