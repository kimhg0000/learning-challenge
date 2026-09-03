import { PROTOTYPE_MODE, isFirebaseConfigValid } from '../config';
import { FirebaseBackend } from './firebaseBackend';
import { LocalBackend } from './localBackend';
import type { Backend } from './types';

export * from './types';
export { SubmissionExistsError, OutsideWindowError } from './firebaseBackend';

function createBackend(): Backend {
  if (PROTOTYPE_MODE) return new LocalBackend();
  if (!isFirebaseConfigValid()) {
    throw new Error(
      'VITE_PROTOTYPE_MODE=false 인 상태에서 Firebase 설정(.env)이 비어 있습니다. ' +
        '.env.example을 참고해 실제 Firebase 프로젝트 값을 채우거나, 데모로 사용하려면 VITE_PROTOTYPE_MODE=true로 설정해주세요.',
    );
  }
  return new FirebaseBackend();
}

export const backend: Backend = createBackend();
