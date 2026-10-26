'use client';
import { useEffect } from 'react';

/**
 * Fades marked elements (`data-reveal`) in as they scroll into view. Renders nothing.
 *
 * The page is complete and fully visible without this: elements are hidden only once this has run in the browser, so
 * with JavaScript off, a failed script, an old browser or reduced-motion enabled, nothing stays invisible. Elements
 * already on screen are shown first and the hiding class is added afterwards, so nothing flashes on load.
 */
export default function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || typeof IntersectionObserver === 'undefined') return;

    const items = Array.from(document.querySelectorAll<HTMLElement>('.site [data-reveal]'));
    const viewport = window.innerHeight;
    const waiting = items.filter((el) => el.getBoundingClientRect().top > viewport * 0.9);
    for (const el of items) if (!waiting.includes(el)) el.classList.add('is-in');
    root.classList.add('reveal-ready');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    waiting.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      root.classList.remove('reveal-ready');
      items.forEach((el) => el.classList.remove('is-in'));
    };
  }, []);

  return null;
}
