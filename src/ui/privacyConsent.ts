import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_CONTACT_NAME,
  PRIVACY_DATA_ITEMS,
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_EXTERNAL_SERVICES,
  PRIVACY_POLICY_VERSION,
  PRIVACY_PURPOSES,
  PRIVACY_RETENTION_TEXT,
} from '../config/privacy';
import { backend } from '../backend';
import { safeText } from '../utils/text';
import { els, showScreen, toast } from './dom';
import { state } from './state';
import { afterLogin } from './auth';
import { invalidateSession, sessionGuard } from './session';

function privacyPolicyHtml(): string {
  const purposes = PRIVACY_PURPOSES.map((p) => `<li>${safeText(p)}</li>`).join('');
  const items = PRIVACY_DATA_ITEMS.map((i) => `<li>${safeText(i)}</li>`).join('');
  const services = PRIVACY_EXTERNAL_SERVICES.map((s) => `<li><b>${safeText(s.name)}</b> — ${safeText(s.purpose)}</li>`).join('');
  return `
    <div class="policy-meta">버전 ${safeText(PRIVACY_POLICY_VERSION)} · 시행일 ${safeText(PRIVACY_EFFECTIVE_DATE)}</div>
    <h3>① 수집·이용 목적</h3>
    <ul>${purposes}</ul>
    <h3>② 수집하는 개인정보 항목</h3>
    <ul>${items}</ul>
    <h3>③ 보유·이용기간</h3>
    <p>${safeText(PRIVACY_RETENTION_TEXT)}</p>
    <h3>④ 동의 거부 권리 및 불이익</h3>
    <p>개인정보 수집·이용에 동의하지 않을 권리가 있습니다. 다만 동의하지 않을 경우 이 웹앱을 통한 학습 챌린지 참여 및 과제 제출이 제한될 수 있습니다. 대체 제출이 필요한 경우 담당 교수자에게 문의해 주세요.</p>
    <h3>⑤ 파기 원칙</h3>
    <p>위 보유·이용기간이 끝나면 해당 개인정보를 지체 없이 파기합니다.</p>
    <h3>⑥ 이용자의 권리</h3>
    <p>본인의 개인정보 열람, 정정, 삭제를 요청할 수 있습니다. 계정 및 관련 기록의 삭제는 담당 교수자에게 요청해주세요.</p>
    <h3>⑦ 서비스 운영을 위해 사용하는 외부 서비스</h3>
    <ul>${services}</ul>
    <h3>⑧ 개인정보 관련 문의처</h3>
    <p>${safeText(PRIVACY_CONTACT_NAME)} · ${safeText(PRIVACY_CONTACT_EMAIL)}</p>
  `.trim();
}

function openPrivacyPolicyModal() {
  els.privacyPolicyBody.innerHTML = privacyPolicyHtml();
  els.privacyPolicyModal.classList.remove('hidden');
}

/** Which flow the current pending consent screen visit is for — set right before showScreen('privacyConsent'); read once the student agrees. */
let pendingConsentSource: 'signup' | 'existing-user' = 'signup';

export function showPrivacyConsentScreen(source: 'signup' | 'existing-user') {
  pendingConsentSource = source;
  els.privacyConsentCheckbox.checked = false;
  els.privacyConsentAgreeBtn.disabled = true;
  showScreen('privacyConsent');
}

export function initPrivacyConsentEvents() {
  els.privacyConsentCheckbox.onchange = () => {
    els.privacyConsentAgreeBtn.disabled = !els.privacyConsentCheckbox.checked;
  };
  els.privacyConsentDetailBtn.onclick = () => openPrivacyPolicyModal();
  els.privacyPolicyLink.onclick = () => openPrivacyPolicyModal();
  els.privacyConsentLogout.onclick = () => { invalidateSession(); void backend.signOutUser(); };

  els.privacyConsentAgreeBtn.onclick = async () => {
    const uid = state.currentUser?.uid;
    const isCurrent = sessionGuard();
    if (!uid || !els.privacyConsentCheckbox.checked) return;
    els.privacyConsentAgreeBtn.disabled = true;
    try {
      await backend.recordPrivacyConsent(uid, pendingConsentSource);
      if (!isCurrent()) return;
      await afterLogin(isCurrent); // continue routing only for this consent session
    } catch (err) {
      if (!isCurrent()) return;
      console.error(err);
      toast('동의 처리 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
      els.privacyConsentAgreeBtn.disabled = false;
    }
  };
}
