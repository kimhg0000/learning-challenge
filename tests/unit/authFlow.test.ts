import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: undefined as undefined | ((user: any) => void),
  backend: { onAuthChange: vi.fn(), signInGoogle: vi.fn(), signInEmail: vi.fn(), signUpEmail: vi.fn(), signOutUser: vi.fn(),
    isInstructor: vi.fn(), getProfile: vi.fn(), getPrivacyConsent: vi.fn(), getMySubmissions: vi.fn(), ensureInstructorProfile: vi.fn() },
  toast: vi.fn(), renderAll: vi.fn(),
}));
vi.mock('../../src/backend', () => ({ backend: mocks.backend }));
vi.mock('../../src/ui/refresh', () => ({ renderAll: mocks.renderAll }));
vi.mock('../../src/ui/adminData', () => ({ clearAdminData: vi.fn() }));
vi.mock('../../src/ui/dom', async importOriginal => ({ ...await importOriginal<any>(), toast: mocks.toast }));
let state: typeof import('../../src/ui/state').state;
let els: typeof import('../../src/ui/dom').els;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  document.body.innerHTML = readFileSync('index.html', 'utf8');
  ({state} = await import('../../src/ui/state')); ({els} = await import('../../src/ui/dom'));
  mocks.backend.onAuthChange.mockImplementation(cb => { mocks.auth = cb; cb(null); });
  mocks.backend.isInstructor.mockResolvedValue(false); mocks.backend.getProfile.mockResolvedValue(null);
  mocks.backend.getPrivacyConsent.mockResolvedValue(null); mocks.backend.getMySubmissions.mockResolvedValue([]);
  mocks.renderAll.mockResolvedValue(undefined);
  (await import('../../src/ui/auth')).initAuthEvents();
});
afterEach(() => vi.useRealTimers());
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
describe('Google click flow', () => {
  it.each(['auth/popup-closed-by-user','auth/cancelled-popup-request'])('%s restores buttons without toast', async code => {
    mocks.backend.signInGoogle.mockRejectedValue({code}); els.googleLoginBtn.click();
    expect(mocks.backend.signInGoogle).toHaveBeenCalledTimes(1); await flush();
    expect(els.googleLoginBtn.disabled).toBe(false); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it.each([['auth/popup-blocked','팝업이 차단'],['auth/network-request-failed','네트워크'],['auth/internal-error','Google 로그인에 실패']])('%s shows correct feedback', async(code,message) => {
    mocks.backend.signInGoogle.mockRejectedValue({code}); els.googleLoginBtn.click(); await flush();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining(message),'error'); expect(els.googleLoginBtn.disabled).toBe(false);
  });
  it('successful Google auth enters privacy gate; late cancellation cannot undo login', async () => {
    let reject!: (error:any)=>void; mocks.backend.signInGoogle.mockImplementation(()=>new Promise((_,r)=>reject=r));
    els.googleLoginBtn.click(); mocks.auth!({uid:'google-student',email:'student@example.test'}); await flush();
    expect(els.privacyConsentScreen.classList.contains('hidden')).toBe(false);
    reject({code:'auth/cancelled-popup-request'}); await flush();
    expect(state.currentUser?.uid).toBe('google-student'); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('email/password invokes its original backend method', async()=>{
    mocks.backend.signInEmail.mockResolvedValue(undefined); els.authEmail.value='student@example.test'; els.authPassword.value='password123';
    els.emailAuthBtn.click(); await flush(); expect(mocks.backend.signInEmail).toHaveBeenCalledWith('student@example.test','password123');
    expect(mocks.backend.signInGoogle).not.toHaveBeenCalled();
  });
  it('production Firebase backend contains no redirect path',()=>{
    const source=readFileSync('src/backend/firebaseBackend.ts','utf8');
    expect(source).not.toContain('signInWithRedirect'); expect(source).toContain('await signInWithPopup');
  });
});
describe('late auth reads',()=>{
  it.each(['logout','switch'])('a pending profile cannot mutate state after %s',async action=>{
    let resolve!: (value:any)=>void; mocks.backend.getProfile.mockImplementationOnce(()=>new Promise(r=>resolve=r));
    mocks.auth!({uid:'old',email:'old@example.test'}); await flush();
    mocks.auth!(action==='logout'?null:{uid:'new',email:'new@example.test'}); await flush();
    resolve({uid:'old',role:'student'}); await flush(); expect(state.profile?.uid).not.toBe('old');
    expect(state.currentUser?.uid).toBe(action==='logout'?undefined:'new');
  });
  it('timed-out profile read is retired even while the same account retries',async()=>{
    vi.useFakeTimers(); let resolve!: (value:any)=>void;
    mocks.backend.getProfile.mockImplementationOnce(()=>new Promise(r=>resolve=r));
    mocks.auth!({uid:'slow',email:'slow@example.test'}); await flush();
    await vi.advanceTimersByTimeAsync(10001); resolve({uid:'obsolete',role:'student'}); await flush();
    expect(state.profile?.uid).not.toBe('obsolete'); await vi.advanceTimersByTimeAsync(1200); await flush();
    expect(mocks.backend.getProfile).toHaveBeenCalledTimes(2);
  });
});
