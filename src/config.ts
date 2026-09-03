export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const env = import.meta.env;

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
