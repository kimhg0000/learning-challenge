import { describe, expect, it } from 'vitest';
import { needsPrivacyConsent } from '../../src/utils/privacyConsent';
import type { PrivacyConsentRecord } from '../../src/backend/types';

function consent(overrides: Partial<PrivacyConsentRecord> = {}): PrivacyConsentRecord {
  return { agreed: true, version: 'v1', agreedAt: '2026-09-07T00:00:00.000Z', source: 'signup', ...overrides };
}

describe('needsPrivacyConsent', () => {
  it('requires consent when there is no record at all (brand-new signup, or a pre-existing account from before this feature)', () => {
    expect(needsPrivacyConsent(null, 'v1')).toBe(true);
  });

  it('does not require consent when the stored version matches the current policy version', () => {
    expect(needsPrivacyConsent(consent({ version: 'v1' }), 'v1')).toBe(false);
  });

  it('requires re-consent when the stored version is older than the current policy version', () => {
    expect(needsPrivacyConsent(consent({ version: 'v1' }), 'v2')).toBe(true);
  });

  it('requires consent when a record exists but agreed is false (defensive — this should never actually be stored)', () => {
    expect(needsPrivacyConsent(consent({ agreed: false, version: 'v1' }), 'v1')).toBe(true);
  });
});
