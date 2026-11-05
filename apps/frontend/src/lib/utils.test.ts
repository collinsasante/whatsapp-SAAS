import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins class names, drops falsy values and lets the later Tailwind utility win', () => {
    expect(cn('px-2', false && 'hidden', undefined, 'py-1')).toBe('px-2 py-1');
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
