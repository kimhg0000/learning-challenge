import { CHARACTER_TYPES } from '../../constants';
import { getGrowthState } from '../../utils/growth';
import { punctualBadgeCount } from '../../utils/punctual';
import { formatGoalSchedule } from '../../utils/goal';
import { els } from '../dom';
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
  els.profileCharacterView.textContent = instructor ? '—' : char.name;
  els.profileGrowthView.textContent = instructor ? '—' : `Lv.${growth.stage} · ${growth.name} · ${growth.xp} XP`;
  els.profileBadgeView.textContent = instructor ? '—' : `${badgeCount}개`;
  els.profileGoalView.textContent = instructor ? '교수자 계정은 개인 행동목표를 설정하지 않습니다.' : profile.goalText || '-';
  els.profileScheduleView.textContent = instructor ? '15주 전체 현황 관리' : formatGoalSchedule(profile);

  els.editGoalBtn.classList.toggle('hidden', instructor);
  els.goalHistoryBtn.classList.toggle('hidden', instructor);
  if (!instructor) els.goalHistoryCount.textContent = `v${profile.currentGoalVersion || 1}`;
}
