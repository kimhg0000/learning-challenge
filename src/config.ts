export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

// Falls back to process.env when import.meta.env doesn't exist at all — real
// Vite builds/dev/vitest always provide it, but a plain `tsx` script (e.g. a
// one-off seed/verification script run outside Vite) does not. Without this
// fallback, any such script crashes on import instead of exercising the real
// app code — which is exactly what previously pushed a staging seed script
// into hand-reimplementing submission logic instead of calling the real
// FirebaseBackend, silently drifting from it (see submitWeek()'s feed-post
// step, added after that drift caused a real bug).
const env = import.meta.env ?? process.env;

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: env.VITE_FIREBASE_APP_ID ?? '',
};

export function isFirebaseConfigValid(): boolean {
  return Object.values(firebaseConfig).every((v) => !!v);
}

// Production deploys MUST set VITE_PROTOTYPE_MODE=false. When unset we fail
// safe towards prototype mode only in local dev (import.meta.env.DEV), and
// towards production behaviour in a built bundle, so an accidental missing
// env var in a real deploy never silently exposes the demo/test UI to students.
export const PROTOTYPE_MODE: boolean = env.VITE_PROTOTYPE_MODE === 'true'
  || (env.VITE_PROTOTYPE_MODE === undefined && env.DEV === true);

// Dev-only escape hatch: real FirebaseBackend + real firestore.rules/
// storage.rules, pointed at a local `npm run rules:emulators` instead of a
// real project. See backend/index.ts. Never meaningful when PROTOTYPE_MODE
// is true (prototype mode takes priority), and no production deploy sets
// this, so it can never reach real students.
export const USE_FIREBASE_EMULATOR: boolean = env.VITE_USE_FIREBASE_EMULATOR === 'true';
