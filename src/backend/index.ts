import { PROTOTYPE_MODE, USE_FIREBASE_EMULATOR, isFirebaseConfigValid } from '../config';
import { FirebaseBackend } from './firebaseBackend';
import { LocalBackend } from './localBackend';
import type { Backend } from './types';

export * from './types';
export { SubmissionExistsError, OutsideWindowError } from './firebaseBackend';

function createBackend(): Backend {
  if (PROTOTYPE_MODE) return new LocalBackend();

  // Local dev/testing against a REAL rules-enforced backend without a real
  // Firebase project: `npm run rules:emulators` in one terminal, then
  // VITE_PROTOTYPE_MODE=false VITE_USE_FIREBASE_EMULATOR=true npm run dev in
  // another. Exercises the actual FirebaseBackend + firestore.rules/
  // storage.rules an instructor's real deploy would run, entirely on
  // localhost. Never true in a real production build (nobody sets this env
  // var there), so it can't accidentally ship.
  if (USE_FIREBASE_EMULATOR) return new FirebaseBackend({ useEmulator: true });

  if (!isFirebaseConfigValid()) {
    throw new Error(
      'VITE_PROTOTYPE_MODE=false 인 상태에서 Firebase 설정(.env)이 비어 있습니다. ' +
        '.env.example을 참고해 실제 Firebase 프로젝트 값을 채우거나, 데모로 사용하려면 VITE_PROTOTYPE_MODE=true로 설정해주세요.',
    );
  }
  return new FirebaseBackend();
}

export const backend: Backend = createBackend();
