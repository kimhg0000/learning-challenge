import { describe, expect, it } from 'vitest';
import { authErrorMessage, postLoginErrorMessage } from '../../src/utils/authErrors';

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

  it('signup: a network failure gets a network-specific message, not the generic fallback', () => {
    expect(authErrorMessage('signup', 'auth/network-request-failed')).toBe('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
  });

  it('signup: a truly unrecognized/unexpected code falls back to a signup-specific generic message', () => {
    expect(authErrorMessage('signup', 'auth/some-unknown-code')).toBe('회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.');
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

  it('login: a network failure gets a network-specific message, not "check your password"', () => {
    expect(authErrorMessage('login', 'auth/network-request-failed')).toBe('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
  });

  it('login: a truly unrecognized/unexpected code falls back to the existing generic login message', () => {
    expect(authErrorMessage('login', 'auth/some-unknown-code')).toBe('로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.');
    expect(authErrorMessage('login', undefined)).toBe('로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.');
  });

  it('an unrecognized error code produces DIFFERENT fallback messages for signup vs. login — proving the two are no longer conflated behind one generic string', () => {
    expect(authErrorMessage('signup', undefined)).not.toBe(authErrorMessage('login', undefined));
  });
});

describe('postLoginErrorMessage', () => {
  it('a withTimeout() timeout gets the network message, not "check your password"', () => {
    expect(postLoginErrorMessage('timeout')).toBe('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
  });

  it('a Firebase Auth network failure gets the network message', () => {
    expect(postLoginErrorMessage('auth/network-request-failed')).toBe('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
  });

  it('a Firestore "unavailable" (backend unreachable) gets the network message', () => {
    expect(postLoginErrorMessage('unavailable')).toBe('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
  });

  it('a genuine permission-denied or unrecognized code falls back to the generic post-login message', () => {
    expect(postLoginErrorMessage('permission-denied')).toBe('로그인 처리 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.');
    expect(postLoginErrorMessage(undefined)).toBe('로그인 처리 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.');
  });
});
