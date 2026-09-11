import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// afterLogin() (src/ui/auth.ts) is DOM/backend-coupled and not practically
// unit-testable by invoking it directly (see the codebase's existing
// UI-regression tests in tests/unit/cameraUi.test.ts for the same reasoning
// applied to index.html markup). This instead guards the SOURCE ORDER of the
// three properties a login-routing bug in this area would most easily break:
// an instructor short-circuiting before the consent gate ever runs, an
// existing student's profile silently exempting them from the gate, and the
// consent screen actually returning instead of falling through to
// onboarding/main. A future edit that reorders these breaks this test even
// though it's not exercising the DOM.
const src = readFileSync('src/ui/auth.ts', 'utf8');

function block(startMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in src/ui/auth.ts: ${startMarker}`);
  const end = src.indexOf('\n  }', start);
  if (end === -1) throw new Error(`closing brace not found for marker: ${startMarker}`);
  return src.slice(start, end);
}

describe('afterLogin() routing order — regression guard for the privacy-consent gate', () => {
  it('checks privacy consent before ever branching on state.profile — an existing student is never exempted from the gate just because they already have a profile', () => {
    const consentCheckIndex = src.indexOf('needsPrivacyConsent(consent');
    const onboardingBranchIndex = src.indexOf('if (!state.profile) {');
    expect(consentCheckIndex).toBeGreaterThan(-1);
    expect(onboardingBranchIndex).toBeGreaterThan(-1);
    expect(consentCheckIndex).toBeLessThan(onboardingBranchIndex);
  });

  it('the consent-needed branch returns immediately after showing the consent screen — no fallthrough into onboarding/main without agreeing', () => {
    const gateBlock = block('if (needsPrivacyConsent(consent');
    expect(gateBlock).toContain('showPrivacyConsentScreen(');
    expect(gateBlock.trim().endsWith('return; // ui/privacyConsent.ts calls afterLogin() again once the student actually agrees')).toBe(true);
  });

  it('instructors are routed to the admin screen and return before the privacy-consent check ever runs (students-only gate)', () => {
    const instructorBranchIndex = src.indexOf('if (instructor) {');
    const consentCheckIndex = src.indexOf('needsPrivacyConsent(consent');
    expect(instructorBranchIndex).toBeGreaterThan(-1);
    expect(instructorBranchIndex).toBeLessThan(consentCheckIndex);

    const instructorBlock = block('if (instructor) {');
    expect(instructorBlock.trim().endsWith('return;')).toBe(true);
  });
});

describe('handleAuthChange() retries afterLogin() once on failure — regression guard for the transient first-read-after-signin failure found in production', () => {
  function handleAuthChangeBody(): string {
    const handlerStart = src.indexOf('async function handleAuthChange');
    expect(handlerStart).toBeGreaterThan(-1);
    return src.slice(handlerStart, src.indexOf('\nasync function doLogout', handlerStart));
  }

  it('catches a failed afterLogin(), retries it once, and only then falls back to the generic error toast', () => {
    const handlerBody = handleAuthChangeBody();

    const firstCallIndex = handlerBody.indexOf('await runPostLogin()');
    const retryCallIndex = handlerBody.indexOf('await runPostLogin()', firstCallIndex + 1);
    expect(firstCallIndex).toBeGreaterThan(-1);
    expect(retryCallIndex).toBeGreaterThan(firstCallIndex); // a SECOND call exists, after the first

    const toastIndex = handlerBody.indexOf('toast(postLoginErrorMessage(');
    expect(toastIndex).toBeGreaterThan(retryCallIndex); // the generic toast only fires after the retry, never before it
  });

  it('both attempts are bounded by withTimeout() — a stalled connection can never leave the student on an infinite loading state', () => {
    const handlerBody = handleAuthChangeBody();
    const timeoutCalls = handlerBody.split('runPostLogin()').length - 1;
    expect(timeoutCalls).toBe(2); // initial attempt + one retry, both bounded
  });

  it('every exit path — success, retry-success, and final failure — resets the login UI (button state)', () => {
    const handlerBody = handleAuthChangeBody();
    const resetCalls = handlerBody.split('resetAuthUi();').length - 1;
    expect(resetCalls).toBeGreaterThanOrEqual(3);
  });

  it('a stale attempt (superseded by a newer onAuthStateChanged firing) bails out instead of racing the newer attempt\'s UI', () => {
    const handlerBody = handleAuthChangeBody();
    expect(handlerBody).toContain('const myAttempt = ++authAttemptId;');
    // Checked at least once after each of the two withTimeout(afterLogin()...) calls.
    const staleChecks = handlerBody.split('if (myAttempt !== authAttemptId) return;').length - 1;
    expect(staleChecks).toBeGreaterThanOrEqual(2);
  });
});

describe('login/signup buttons — duplicate-click and duplicate-popup guards', () => {
  function clickHandlerBody(elId: string, nextMarker: string): string {
    const start = src.indexOf(`${elId}.onclick = async () => {`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(nextMarker, start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('the email login/signup button bails out immediately on a duplicate click while a request is already in flight', () => {
    const body = clickHandlerBody('els.emailAuthBtn', 'els.googleLoginBtn.onclick');
    const guardIndex = body.indexOf('if (authFlowInFlight) return;');
    const busyIndex = body.indexOf('setAuthUiBusy(true);');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(busyIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(busyIndex); // the guard is checked BEFORE marking the UI busy, not after
    expect(guardIndex).toBeLessThan(60); // it's the very first statement in the handler, not buried after other logic
  });

  it('the Google login button bails out immediately on a duplicate click/popup while a request is already in flight', () => {
    const body = clickHandlerBody('els.googleLoginBtn', 'els.profileStudentId.oninput');
    const guardIndex = body.indexOf('if (authFlowInFlight) return;');
    const busyIndex = body.indexOf('setAuthUiBusy(true);');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(busyIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(busyIndex);
    expect(guardIndex).toBeLessThan(60);
  });

  it('setAuthUiBusy() disables both auth buttons and the mode-switch button together, so neither path can be triggered while the other is in flight', () => {
    const start = src.indexOf('function setAuthUiBusy(busy: boolean) {');
    const body = src.slice(start, src.indexOf('\n}', start));
    expect(body).toContain('els.emailAuthBtn.disabled = busy;');
    expect(body).toContain('els.googleLoginBtn.disabled = busy;');
    expect(body).toContain('els.authSwitchBtn.disabled = busy;');
  });
});
