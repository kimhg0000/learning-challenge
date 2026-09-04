import { CHARACTER_TYPES } from '../../constants';
import { getGrowthState } from '../../utils/growth';
import { punctualBadgeCount } from '../../utils/punctual';
import { formatGoalSchedule } from '../../utils/goal';
import { isValidName, isValidStudentId } from '../../utils/validation';
import { backend } from '../../backend';
import { els, toast } from '../dom';
import { state } from '../state';
import { characterMarkup } from '../character';

export function renderProfile() {
  const profile = state.profile;
  if (!profile) return;
  const instructor = profile.role === 'instructor';
  const doneCount = instructor ? 0 : state.submissions.length;
  const badgeCount = instructor ? 0 : punctualBadgeCount(state.submissions);
  const growth = getGrowthState(doneCount);
  const char = CHARACTER_TYPES[profile.characterType] ?? CHARACTER_TYPES.rabbit;

  els.profileAvatar.innerHTML = instructor ? '👩‍🏫' : characterMarkup(profile.characterType, doneCount, 'medium');
  els.profileNameView.textContent = profile.name || (instructor ? '교수자' : '-');
  els.profileIdView.textContent = instructor ? '교수자 계정' : `학번 ${profile.studentId || '-'}`;
  els.profileEmailView.textContent = state.currentUser?.email || (state.currentUser ? '데모 계정' : '-');
  els.profileAnonView.textContent = instructor ? '학생에게 노출되지 않음' : profile.anonName;
  els.profileNameRowView.textContent = profile.name || '-';
  els.profileStudentIdRowView.textContent = instructor ? '해당 없음' : profile.studentId || '-';
  els.profileCharacterView.textContent = instructor ? '—' : char.name;
  els.profileGrowthView.textContent = instructor ? '—' : `Lv.${growth.stage} · ${growth.name} · ${growth.xp} XP`;
  els.profileBadgeView.textContent = instructor ? '—' : `${badgeCount}개`;
  els.profileNextGrowthView.textContent = instructor
    ? '—'
    : growth.next
      ? `${growth.next.minCompleted - doneCount}주 남음`
      : '최종 성장형 도달';
  els.profileGoalView.textContent = instructor ? '교수자 계정은 개인 행동목표를 설정하지 않습니다.' : profile.goalText || '-';
  els.profileScheduleView.textContent = instructor ? '15주 전체 현황 관리' : formatGoalSchedule(profile);

  els.editGoalBtn.classList.toggle('hidden', instructor);
  els.goalHistoryBtn.classList.toggle('hidden', instructor);
  els.editProfileBtn.classList.toggle('hidden', instructor);
  if (!instructor) els.goalHistoryCount.textContent = `v${profile.currentGoalVersion || 1}`;
}

function openProfileEdit() {
  const profile = state.profile;
  if (!profile) return;
  els.editProfileName.value = profile.name || '';
  els.editProfileStudentId.value = profile.studentId || '';
  els.profileEditModal.classList.remove('hidden');
}

async function saveProfileEdit() {
  const uid = state.currentUser?.uid;
  if (!uid) return;
  const name = els.editProfileName.value.trim();
  const studentId = els.editProfileStudentId.value.trim();
  if (!isValidName(name)) return toast('이름을 정확히 입력해주세요.', 'error');
  if (!isValidStudentId(studentId)) return toast('학번은 반드시 7자리 숫자여야 합니다.', 'error');

  if (!window.confirm('이름 또는 학번을 변경하시겠습니까? 변경 이력이 기록되며, 이미 제출한 주차의 기록은 바뀌지 않습니다.')) return;

  els.saveProfileEditBtn.disabled = true;
  try {
    state.profile = await backend.updateProfile(uid, { name, studentId });
    renderProfile();
    els.profileEditModal.classList.add('hidden');
    toast('프로필이 수정되었습니다.', 'success');
  } catch (err) {
    console.error(err);
    toast(err instanceof Error ? err.message : '프로필 수정에 실패했습니다.', 'error');
  } finally {
    els.saveProfileEditBtn.disabled = false;
  }
}

export function initProfileEvents() {
  els.editProfileStudentId.oninput = () => {
    els.editProfileStudentId.value = els.editProfileStudentId.value.replace(/\D/g, '').slice(0, 7);
  };
  els.editProfileBtn.onclick = openProfileEdit;
  els.saveProfileEditBtn.onclick = () => void saveProfileEdit();
}
