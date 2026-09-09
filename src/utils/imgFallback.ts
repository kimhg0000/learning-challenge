import { safeText } from './text';

/**
 * An <img> tag that replaces itself with a clear text placeholder if the
 * source fails to load, instead of leaving the browser's raw broken-image
 * icon on screen. A real photo failing to decode (deleted Storage object,
 * transient network failure, or — as happened once with placeholder test
 * data — a non-image blob stored under an image content-type) previously
 * rendered as an ambiguous broken icon with no explanation.
 *
 * Always carries loading="lazy"/decoding="async"/fetchpriority="low" — this
 * is used for every Feed/admin list card, where a single screen can contain
 * anywhere from a handful to (at semester's end, for an instructor with no
 * filter) hundreds of these tags at once. Without these attributes the
 * browser would fetch and decode every one of them immediately regardless of
 * whether it's ever scrolled into view. This helper is never used for the
 * single large detail-view photo (submission detail modal's #detail-photo is
 * a plain <img> the UI sets .src on directly), so that flow is unaffected.
 */
export function imgWithFallback(src: string | undefined, alt: string, className: string): string {
  const safeSrc = safeText(src || '');
  const safeAlt = safeText(alt);
  const fallbackHtml = `<div class="${className} img-fallback">이미지를 불러올 수 없습니다</div>`.replace(/"/g, '&quot;');
  return `<img src="${safeSrc}" alt="${safeAlt}" class="${className}" loading="lazy" decoding="async" fetchpriority="low" onerror="this.outerHTML='${fallbackHtml}'">`;
}
