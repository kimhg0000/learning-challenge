// ---------------------------------------------------------------------------
// Single source of truth for every piece of privacy-notice copy shown in the
// app (the consent screen, the "자세히 보기" / 개인정보 처리방침 modal, and
// the instructor's per-student consent status line). Changing wording,
// bumping the policy version, or updating the contact channel is always a
// one-file edit — nothing below is duplicated into index.html or any UI
// module.
//
// PRIVACY_CONTACT_NAME / PRIVACY_CONTACT_EMAIL are deliberately placeholders
// until the course owner confirms who actually handles privacy inquiries —
// see the completion report for what to fill in here before real students
// rely on this screen.
// ---------------------------------------------------------------------------

/**
 * Bump this whenever the policy text changes in a way that should force
 * every student to re-consent (see utils/privacyConsent.ts
 * needsPrivacyConsent()). A student's stored consent record pins the version
 * they agreed to; a mismatch with this value means their next login shows
 * the consent screen again.
 */
export const PRIVACY_POLICY_VERSION = '2026-09-07-v1';

/** Human-readable effective date shown alongside the version in the policy modal. */
export const PRIVACY_EFFECTIVE_DATE = '2026-09-07';

/**
 * Deliberately vague about an exact retention period: the course's official
 * data-retention rule has not been confirmed yet (see task instructions).
 * Never hardcode a specific duration here without that confirmation — update
 * this one string once it is, and every screen that shows it updates together.
 */
export const PRIVACY_RETENTION_TEXT =
  '수업 운영 및 성적 확인 등 필요한 절차가 종료된 후 지체 없이 파기합니다. 구체적인 보유기간은 소속 기관의 개인정보 처리 기준에 따릅니다.';

/** PLACEHOLDER — replace with the real privacy-inquiry contact before relying on this in production. */
export const PRIVACY_CONTACT_NAME = '담당 교수자 (문의처 확정 전)';
/** PLACEHOLDER — replace with the real privacy-inquiry contact email before relying on this in production. */
export const PRIVACY_CONTACT_EMAIL = 'TBD@example.com';

export const PRIVACY_PURPOSES: string[] = [
  '15주 학습 챌린지 참여자 식별',
  '학습 목표 및 주차별 활동 관리',
  '학습 인증 및 성찰 기록 관리',
  '제출 여부 및 정시 제출 여부 확인',
  '교수자의 수업 운영 및 학생 제출 현황 관리',
];

// Kept to exactly what the app actually stores today (see src/types.ts
// UserProfile/Submission) — never list an item the code doesn't collect.
export const PRIVACY_DATA_ITEMS: string[] = [
  '이름',
  '학번',
  '이메일',
  '로그인 계정 식별정보',
  '학습 목표',
  '계획 요일 및 시간',
  '인증사진',
  '성찰내용',
  '제출일시',
  '정시 제출 여부',
  '캐릭터/활동 진행 정보',
];

export interface PrivacyExternalService {
  name: string;
  purpose: string;
}

// Matches the real backend today (src/backend/firebaseBackend.ts,
// functions/src/index.ts, netlify.toml). Deliberately described as plain
// operational fact ("이 서비스를 사용합니다"), not a legal classification
// (처리위탁/국외이전 등) — that classification needs the institution's own
// review and must not be guessed here.
export const PRIVACY_EXTERNAL_SERVICES: PrivacyExternalService[] = [
  { name: 'Netlify / Cloudflare Pages', purpose: '웹 프론트엔드 호스팅' },
  { name: 'Firebase Authentication', purpose: '로그인 및 회원 인증' },
  { name: 'Cloud Firestore', purpose: '학생 프로필·목표·제출기록 등 데이터 저장' },
  { name: 'Firebase Storage', purpose: '인증사진 저장' },
  { name: 'Firebase Cloud Functions', purpose: '교수자의 학생 계정 삭제 등 권한이 필요한 백엔드 처리' },
];
