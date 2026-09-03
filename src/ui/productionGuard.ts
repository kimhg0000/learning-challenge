import { PROTOTYPE_MODE } from '../config';
import { els } from './dom';

/**
 * Production/prototype separation, enforced structurally rather than
 * cosmetically. Earlier this only toggled a `hidden` CSS class on
 * prototype-only elements, which meant a student could remove that class
 * in devtools and reach the "체험하기" login, the test-week picker, the
 * fake photo generator, or the punctual-badge override checkbox even in a
 * real production deploy. This instead permanently removes those DOM nodes
 * from the page the moment the app boots when VITE_PROTOTYPE_MODE=false, so
 * there is nothing left in the live DOM to un-hide.
 *
 * Must run once, immediately, before any other UI module reads or renders
 * into these elements.
 */
export function stripPrototypeOnlyUiInProduction(): void {
  if (PROTOTYPE_MODE) return;
  els.prototypeEntry.remove();
  els.prototypeBanner.remove(); // also removes the nested #test-week-select
  els.prototypePhotoBtn.remove();
  els.prototypePunctualBox.remove(); // also removes the nested #prototype-punctual-check
}
