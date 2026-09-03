import './styles.css';
import { stripPrototypeOnlyUiInProduction } from './ui/productionGuard';
import { populateSelectors } from './ui/selectors';
import { initAuthEvents } from './ui/auth';
import { initModalEvents } from './ui/modals';
import { initAdminEvents } from './ui/screens/admin';
import { registerTabChangeHandler, toast } from './ui/dom';
import { onTabActivated } from './ui/refresh';

// Must run before any other UI module renders into or reveals prototype-only
// elements (see productionGuard.ts for why cosmetic hiding isn't enough).
stripPrototypeOnlyUiInProduction();

populateSelectors();
registerTabChangeHandler((tab) => void onTabActivated(tab));
initAuthEvents();
initModalEvents();
initAdminEvents();

if ('serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          toast('새 버전이 있습니다. 앱을 새로고침해주세요.', 'info');
          const banner = document.createElement('button');
          banner.textContent = '지금 새로고침';
          banner.className = 'btn btn-primary';
          banner.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:200;';
          banner.onclick = () => void updateSW(true);
          document.body.appendChild(banner);
        },
        onOfflineReady() {
          toast('오프라인에서도 앱을 열 수 있도록 준비되었습니다.', 'success');
        },
      });
    })
    .catch(() => {
      // Dev server / unsupported browser: PWA registration is best-effort only.
    });
}
