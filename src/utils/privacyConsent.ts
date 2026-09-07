import type { PrivacyConsentRecord } from '../backend/types';

/**
 * True whenever a student must be shown the privacy-consent screen before
 * entering the app: no record at all (brand-new signup, or an existing
 * account created before this feature existed), or a record that agreed to
 * an older policy version than the one currently in effect (see
 * config/privacy.ts PRIVACY_POLICY_VERSION). A record with agreed:false
 * should never actually be stored (see firestore.rules), but is treated the
 * same as "no record" defensively.
 */
export function needsPrivacyConsent(consent: PrivacyConsentRecord | null, currentVersion: string): boolean {
  return !consent || !consent.agreed || consent.version !== currentVersion;
}
