'use client';
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Gives a hand-built modal the behaviour of a real dialog, so it works from the keyboard and with a screen reader:
 * - Escape closes it;
 * - focus moves into it when it opens and returns to whatever had it when it closes;
 * - Tab and Shift+Tab stay inside it;
 * - it is labelled by its first heading (aria-labelledby is set when the heading exists).
 * Attach the returned ref to the dialog panel and give that element role="dialog" and aria-modal="true".
 */
export function useDialogBehavior<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const heading = node.querySelector<HTMLElement>('h1, h2, h3');
    if (heading) {
      if (!heading.id) heading.id = `dialog-title-${Math.random().toString(36).slice(2, 10)}`;
      node.setAttribute('aria-labelledby', heading.id);
    }

    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    (focusables()[0] ?? node).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return ref;
}
