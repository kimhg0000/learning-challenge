import { PROTOTYPE_MODE } from '../config';
import { backend } from '../backend';
import { els } from './dom';
import { state } from './state';
import { renderHome } from './screens/home';
import { renderWeeks } from './screens/weeks';
import { renderProfile } from './screens/profile';
import { loadHomeRecentFeed, loadPublicFeed } from './screens/feed';
import { loadAdminDashboard } from './screens/admin';
import { sessionGuard } from './session';

function isInstructor(): boolean {
  return state.profile?.role === 'instructor';
}

export async function renderAll(isCurrent: () => boolean = sessionGuard()) {
  if (!isCurrent()) return;
  const instructor = isInstructor();
  els.adminNavBtn.classList.toggle('hidden', !instructor);
  const homeNav = document.querySelector<HTMLElement>('[data-tab="home"]')!;
  const weeksNav = document.querySelector<HTMLElement>('[data-tab="weeks"]')!;
  homeNav.classList.toggle('hidden', instructor);
  weeksNav.classList.toggle('hidden', instructor);
  const visibleNav = [...document.querySelectorAll('.nav-btn')].filter((b) => !b.classList.contains('hidden')).length;
  els.bottomNav.style.gridTemplateColumns = `repeat(${visibleNav},1fr)`;

  await Promise.all([loadPublicFeed(isCurrent), loadHomeRecentFeed(isCurrent)]);
  if (!isCurrent()) return;
  renderProfile();
  els.prototypeBanner.classList.toggle('hidden', instructor || !PROTOTYPE_MODE);
  if (!instructor) {
    renderHome();
    renderWeeks();
  }
}

export async function onTabActivated(tab: string) {
  if (tab === 'feed') await loadPublicFeed();
  if (tab === 'admin') await loadAdminDashboard();
}

/** Reloads this student's own submissions + feed + all student-facing screens after a successful weekly submission. */
export async function refreshAfterSubmission() {
  const isCurrent = sessionGuard();
  const uid = state.currentUser?.uid;
  if (!uid) return;
  const submissions = await backend.getMySubmissions(uid);
  if (!isCurrent()) return;
  state.submissions = submissions;
  await renderAll(isCurrent);
}
