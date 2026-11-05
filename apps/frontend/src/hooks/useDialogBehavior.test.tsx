import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useDialogBehavior } from './useDialogBehavior';

function Modal({ onClose }: { onClose: () => void }) {
  const ref = useDialogBehavior<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true">
      <h2>Connect Messenger</h2>
      <button>First</button>
      <input aria-label="Email" />
      <button>Last</button>
    </div>
  );
}

function Host({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Modal onClose={() => { onClose(); setOpen(false); }} />}
    </>
  );
}

describe('useDialogBehavior', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus into the dialog on open and back to the opener on close', () => {
    render(<Host />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByText('First'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('labels the dialog by its heading', () => {
    render(<Host />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Connect Messenger');
    expect(screen.getByRole('dialog', { name: 'Connect Messenger' })).toBeTruthy();
  });

  it('keeps Tab inside the dialog, wrapping from last to first and from first back to last', () => {
    render(<Host />);
    fireEvent.click(screen.getByText('Open'));
    const first = screen.getByText('First');
    const last = screen.getByText('Last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('stops listening once closed', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
