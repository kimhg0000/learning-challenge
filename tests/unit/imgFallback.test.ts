import { describe, expect, it } from 'vitest';
import { imgWithFallback } from '../../src/utils/imgFallback';

describe('imgWithFallback', () => {
  it('renders a normal <img> with the given src, alt, and class', () => {
    const html = imgWithFallback('https://example.com/photo.jpg', '인증샷', 'my-class');
    expect(html).toContain('src="https://example.com/photo.jpg"');
    expect(html).toContain('alt="인증샷"');
    expect(html).toContain('class="my-class"');
  });

  it('escapes attacker-controlled src/alt so it cannot break out of the attribute or inject a tag', () => {
    const html = imgWithFallback('"><script>alert(1)</script>', '"onmouseover="x', 'c');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onmouseover="x"');
  });

  it('carries an onerror handler that swaps in a visible text fallback instead of a raw broken-image icon', () => {
    const html = imgWithFallback('https://example.com/broken.jpg', '인증샷', 'thumb');
    expect(html).toContain('onerror=');
    expect(html).toContain('이미지를 불러올 수 없습니다');
    expect(html).toContain('img-fallback');
  });

  it('falls back to an empty src (not the string "undefined") when no photo URL is given', () => {
    const html = imgWithFallback(undefined, '인증샷', 'thumb');
    expect(html).toContain('src=""');
  });

  // Feed/admin screens can render anywhere from a handful up to hundreds of
  // these tags on one page (see storage/feed-scale hotfix) — every one of
  // them must defer its own network fetch/decode until it is actually
  // scrolled near the viewport.
  it('carries loading="lazy" and decoding="async" so offscreen images are never fetched/decoded immediately', () => {
    const html = imgWithFallback('https://example.com/photo.jpg', '인증샷', 'feed-img');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('carries fetchpriority="low" so these never compete with the current screen\'s primary content', () => {
    const html = imgWithFallback('https://example.com/photo.jpg', '인증샷', 'feed-img');
    expect(html).toContain('fetchpriority="low"');
  });
});
