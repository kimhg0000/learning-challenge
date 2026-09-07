/**
 * Races `promise` against a bounded wait. If `promise` doesn't settle within
 * `ms`, the returned promise rejects with an Error whose `code` is
 * `'timeout'` — a genuinely stalled connection (e.g. a Firestore read that
 * never resolves) then surfaces as a normal, catchable failure instead of
 * leaving a caller (and the UI it drives) waiting forever. `promise` itself
 * is never cancelled — if it eventually settles after the timeout has
 * already fired, that settlement is simply ignored by this wrapper; a
 * caller that cares about staleness (e.g. a newer attempt having since
 * superseded this one) needs its own guard for that, as ui/auth.ts's
 * authAttemptId does.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('로그인 처리 시간이 초과되었습니다.'), { code: 'timeout' })), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
