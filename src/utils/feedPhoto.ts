/** Changes the cache key without modifying persisted download tokens/URLs. */
export function feedPhotoURL(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('data:')) return url; // LocalBackend only
  try {
    const parsed = new URL(url);
    // Never accept a private proof-photo URL as a public card fallback.
    if (!decodeURIComponent(parsed.pathname).includes('/o/feedPhotos/')) return '';
    parsed.searchParams.set('thumbnail', 'jpeg-1200-q78-v1');
    return parsed.toString();
  } catch { return ''; }
}

export async function submissionFeedId(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
