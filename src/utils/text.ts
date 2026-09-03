const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#039;',
  '"': '&quot;',
};

export function safeText(str: unknown = ''): string {
  return String(str ?? '').replace(/[&<>'"]/g, (ch) => ESCAPE_MAP[ch]);
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Generates a stable-looking anonymous display name from a uid. Called once,
 * at profile creation, and the result is stored permanently on the user's
 * document (`anonName`) — never recomputed from the uid on the read/feed
 * side, so the anonymous feed never has to carry or derive anything from a
 * student's uid.
 */
export function makeAnonName(uid: string): string {
  return `도전자 ${String(hashCode(uid) % 900 + 100)}`;
}
