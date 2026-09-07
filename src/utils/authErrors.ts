/**
 * Maps a Firebase Auth error code to a user-facing message, distinguishing
 * signup failures from login failures — a real production account can exist
 * in Auth with no Firestore profile/consent yet (e.g. the student closed the
 * app before onboarding finished), and retrying "회원가입" on that email then
 * throws auth/email-already-in-use. Showing the generic login-failure
 * message for that case ("이메일/비밀번호를 확인해주세요") tells the student
 * their password is wrong when the real issue is that they already have an
 * account and should switch to 로그인 instead.
 */
export function authErrorMessage(mode: 'signup' | 'login', code: string | undefined): string {
  if (mode === 'signup') {
    switch (code) {
      case 'auth/email-already-in-use':
        return '이미 가입된 이메일입니다. 로그인해 주세요.';
      case 'auth/invalid-email':
        return '올바른 이메일 형식이 아닙니다.';
      case 'auth/weak-password':
        return '비밀번호는 6자 이상이어야 합니다.';
      case 'auth/network-request-failed':
        return '네트워크 연결을 확인한 뒤 다시 시도해주세요.';
      default:
        return '회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.';
    }
  }
  switch (code) {
    case 'auth/invalid-email':
      return '올바른 이메일 형식이 아닙니다.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'auth/network-request-failed':
      return '네트워크 연결을 확인한 뒤 다시 시도해주세요.';
    default:
      return '로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.';
  }
}
