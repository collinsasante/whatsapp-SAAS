'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function DropdownItem({ children, onClick, className, disabled }: DropdownItemProps) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'dropdown-item w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface DropdownDividerProps { className?: string }
export function DropdownDivider({ className }: DropdownDividerProps) {
  return <hr className={cn('my-1 border-gray-100', className)} />;
}

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
}

export function Dropdown({ trigger, children, align = 'left', className, menuClassName, disabled }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={cn('dropdown relative', className)} ref={ref}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="dropdown-toggle w-full"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'dropdown-menu absolute z-50 mt-1 bg-white rounded-xl border border-gray-100 shadow-xl py-1 min-w-[160px]',
            align === 'right' ? 'right-0' : 'left-0',
            menuClassName,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
