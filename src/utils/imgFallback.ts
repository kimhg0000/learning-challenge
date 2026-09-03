import { safeText } from './text';

/**
 * An <img> tag that replaces itself with a clear text placeholder if the
 * source fails to load, instead of leaving the browser's raw broken-image
 * icon on screen. A real photo failing to decode (deleted Storage object,
 * transient network failure, or — as happened once with placeholder test
 * data — a non-image blob stored under an image content-type) previously
 * rendered as an ambiguous broken icon with no explanation.
 */
export function imgWithFallback(src: string | undefined, alt: string, className: string): string {
  const safeSrc = safeText(src || '');
  const safeAlt = safeText(alt);
  const fallbackHtml = `<div class="${className} img-fallback">이미지를 불러올 수 없습니다</div>`.replace(/"/g, '&quot;');
  return `<img src="${safeSrc}" alt="${safeAlt}" class="${className}" onerror="this.outerHTML='${fallbackHtml}'">`;
}
