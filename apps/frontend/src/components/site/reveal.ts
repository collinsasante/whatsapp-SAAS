import type { CSSProperties } from 'react';

/**
 * Attributes that mark an element for the scroll-reveal animation (see ScrollReveal and site.css). They change
 * nothing visually on their own: the element is only hidden, and then faded in, after the page script has run.
 * `index` staggers a group; the delay is capped so the last item of a long list never feels slow.
 */
export function reveal(index = 0): { 'data-reveal': ''; style: CSSProperties } {
  return { 'data-reveal': '', style: { ['--reveal-delay' as string]: `${Math.min(index, 5) * 80}ms` } as CSSProperties };
}
