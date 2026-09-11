import { state } from './state';

let revision = 0;
export function invalidateSession(): void { revision++; }
export function sessionGuard(): () => boolean {
  const captured = revision;
  const uid = state.currentUser?.uid;
  return () => captured === revision && uid === state.currentUser?.uid;
}
