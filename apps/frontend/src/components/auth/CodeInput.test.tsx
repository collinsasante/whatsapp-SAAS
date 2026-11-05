import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { CodeInput, type CodeStatus } from './CodeInput';

function Host({ onComplete = () => undefined, onChangeSpy, status = 'idle', mask = false, autoFocus = true, initial = '' }: {
  onComplete?: (code: string) => void; onChangeSpy?: (v: string) => void; status?: CodeStatus; mask?: boolean; autoFocus?: boolean; initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <button>elsewhere</button>
      <CodeInput aria-label="Code" value={value} status={status} mask={mask} autoFocus={autoFocus} onChange={(v) => { onChangeSpy?.(v); setValue(v); }} onComplete={onComplete} />
    </div>
  );
}

const input = () => screen.getByLabelText('Code') as HTMLInputElement;

describe('CodeInput: focus', () => {
  it('takes focus when it mounts, so the user can type at once', () => {
    render(<Host />);
    expect(document.activeElement).toBe(input());
  });

  it('does not take focus when autoFocus is off', () => {
    render(<Host autoFocus={false} />);
    expect(document.activeElement).not.toBe(input());
  });

  it('gets focus back when the user returns to the tab and nothing else has focus', () => {
    render(<Host />);
    input().blur();
    expect(document.activeElement).toBe(document.body);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(document.activeElement).toBe(input());
  });

  it('never steals focus from something the user chose', () => {
    render(<Host />);
    const other = screen.getByText('elsewhere');
    other.focus();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    expect(document.activeElement).toBe(other);
  });

  it('stops listening once it is unmounted (no focus pulled onto a screen the user has left)', () => {
    const { unmount } = render(<Host />);
    const add = vi.spyOn(document, 'removeEventListener');
    unmount();
    expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    add.mockRestore();
  });
});

describe('CodeInput: one-time-code autofill and paste', () => {
  it('declares itself as a one-time-code field with the numeric keyboard (what lets the OS offer a code it already received)', () => {
    render(<Host />);
    expect(input()).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input()).toHaveAttribute('inputmode', 'numeric');
    expect(input()).toHaveAttribute('pattern', '[0-9]*');
  });

  it('fills the whole code when the system autofills it in one go, and reports completion once', () => {
    const done = vi.fn();
    render(<Host onComplete={done} />);
    fireEvent.change(input(), { target: { value: '482913' } });
    expect(input().value).toBe('482913');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('482913');
  });

  it.each([['123 456', '123456'], ['123-456', '123456'], [' 654321\n', '654321'], ['12ab34cd56', '123456'], ['1234567890', '123456']])(
    'pasting %j gives %j',
    (pasted, expected) => {
      const done = vi.fn();
      render(<Host onComplete={done} />);
      fireEvent.paste(input(), { clipboardData: { getData: () => pasted } });
      expect(input().value).toBe(expected);
      expect(done).toHaveBeenCalledTimes(1);
    },
  );

  it('a partial paste fills what it can and does not complete', () => {
    const done = vi.fn();
    render(<Host onComplete={done} />);
    fireEvent.paste(input(), { clipboardData: { getData: () => '123' } });
    expect(input().value).toBe('123');
    expect(done).not.toHaveBeenCalled();
  });

  it('manual typing works one digit at a time and ignores everything that is not a digit', () => {
    const done = vi.fn();
    render(<Host onComplete={done} />);
    for (const partial of ['1', '12', '12x', '123', '1234', '12345', '123456']) fireEvent.change(input(), { target: { value: partial } });
    expect(input().value).toBe('123456');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('backspace removes the last digit', () => {
    render(<Host initial="1234" />);
    fireEvent.change(input(), { target: { value: '123' } });
    expect(input().value).toBe('123');
  });

  it('Enter on a short code does not ask to submit', () => {
    const done = vi.fn();
    render(<Host onComplete={done} initial="123" />);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(done).not.toHaveBeenCalled();
  });

  it('Enter on a full code asks to submit', () => {
    const done = vi.fn();
    render(<Host onComplete={done} initial="123456" />);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(done).toHaveBeenCalledWith('123456');
  });
});

describe('CodeInput: duplicate submissions and states', () => {
  it.each<CodeStatus>(['verifying', 'success'])('ignores typing, paste and Enter while %s, so a second submission cannot start', (status) => {
    const done = vi.fn(); const changed = vi.fn();
    render(<Host status={status} initial="123456" onComplete={done} onChangeSpy={changed} />);
    expect(input()).toHaveAttribute('readonly');
    fireEvent.change(input(), { target: { value: '999999' } });
    fireEvent.paste(input(), { clipboardData: { getData: () => '111111' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(changed).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(input().value).toBe('123456');
  });

  it('exposes verifying as busy for assistive technology', () => {
    render(<Host status="verifying" initial="123456" />);
    expect(input()).toHaveAttribute('aria-busy', 'true');
  });

  it('marks an error: invalid for assistive technology, and the tiles shake and turn red', () => {
    const { container } = render(<Host status="error" initial="123456" />);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    const tiles = container.querySelectorAll('.code-tile-shake');
    expect(tiles).toHaveLength(6);
    expect(tiles[0].className).toContain('text-red-700');
  });

  it('shows success in green and verifying as a pulse', () => {
    const { container, rerender } = render(<Host status="success" initial="123456" />);
    expect(container.querySelectorAll('.text-emerald-700')).toHaveLength(6);
    rerender(<Host status="verifying" initial="123456" />);
    expect(container.querySelectorAll('.code-tile-verifying')).toHaveLength(6);
  });

  it('highlights exactly one active position while idle, and none when locked', () => {
    const { container, rerender } = render(<Host initial="12" />);
    expect(container.querySelectorAll('.group-focus-within\\:ring-2')).toHaveLength(1);
    rerender(<Host initial="12" status="verifying" />);
    expect(container.querySelectorAll('.group-focus-within\\:ring-2')).toHaveLength(0);
  });

  it('masks a PIN as dots and shows a one-time code as digits', () => {
    const { container, rerender } = render(<Host initial="1234" mask />);
    expect(container.querySelectorAll('span.rounded-full')).toHaveLength(4);
    expect(container.textContent).not.toContain('1234');
    rerender(<Host initial="1234" mask={false} />);
    expect(container.textContent).toContain('1234');
  });

  it('keeps the tiles out of the accessibility tree: one labelled field, not six', () => {
    const { container } = render(<Host initial="123" />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
