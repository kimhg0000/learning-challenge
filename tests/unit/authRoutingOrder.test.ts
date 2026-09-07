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
