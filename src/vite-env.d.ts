/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_PROTOTYPE_MODE?: string;
  readonly VITE_USE_FIREBASE_EMULATOR?: string;
  /** Staging-only overrides — see constants.ts. Never set in a production build. */
  readonly VITE_PROGRAM_START?: string;
  readonly VITE_PROGRAM_END?: string;
  readonly VITE_SEMESTER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { readonly DEV: boolean; readonly PROD: boolean };
}
