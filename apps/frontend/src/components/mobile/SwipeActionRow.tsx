'use client';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SwipeAction {
  icon: React.ReactNode;
  label: string;
  color: string; // tailwind bg class e.g. 'bg-red-500'
  textColor?: string;
  onAction: () => void;
}

interface SwipeActionRowProps {
  children: React.ReactNode;
  actions: SwipeAction[]; // rendered on left-swipe (right side of row)
  className?: string;
  disabled?: boolean;
}

const ACTION_WIDTH = 72;

export function SwipeActionRow({ children, actions, className, disabled }: SwipeActionRowProps) {
  const startX = useRef(0);
  const currentX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const maxReveal = actions.length * ACTION_WIDTH;

  const onStart = (x: number) => {
    if (disabled) return;
    startX.current = x;
    setDragging(true);
  };

  const onMove = (x: number) => {
    if (!dragging || disabled) return;
    const dx = startX.current - x; // positive = swipe left
    if (dx < 0 && !revealed) { setOffset(0); return; }
    if (dx < 0 && revealed) {
      const newOffset = Math.max(0, maxReveal + dx);
      setOffset(newOffset);
      return;
    }
    const raw = revealed ? maxReveal + dx : dx;
    setOffset(Math.min(raw, maxReveal + 12));
    currentX.current = dx;
  };

  const onEnd = () => {
    if (!dragging || disabled) return;
    setDragging(false);
    const threshold = maxReveal * 0.4;
    if (offset >= threshold) {
      setOffset(maxReveal);
      setRevealed(true);
    } else {
      setOffset(0);
      setRevealed(false);
    }
  };

  const dismiss = () => { setOffset(0); setRevealed(false); };

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* action buttons (revealed on left-swipe) */}
      <div
        className="absolute right-0 top-0 bottom-0 flex"
        style={{ width: maxReveal }}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => { action.onAction(); dismiss(); }}
            style={{ width: ACTION_WIDTH }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 flex-shrink-0 transition-colors',
              action.color,
              action.textColor ?? 'text-white',
            )}
          >
            {action.icon}
            <span className="text-[10px] font-semibold">{action.label}</span>
          </button>
        ))}
      </div>

      {/* main row content — slides left to reveal actions */}
      <div
        style={{
          transform: `translateX(-${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.25s ease-out',
        }}
        className="relative bg-white z-10"
        onMouseDown={(e) => onStart(e.clientX)}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseUp={onEnd}
        onMouseLeave={onEnd}
        onTouchStart={(e) => onStart(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={onEnd}
      >
        {children}
      </div>
    </div>
  );
}
