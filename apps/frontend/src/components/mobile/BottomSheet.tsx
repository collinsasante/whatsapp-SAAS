'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  height?: 'auto' | 'half' | 'tall' | 'full';
  className?: string;
}

export function BottomSheet({
  open, onClose, title, children, height = 'auto', className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragDeltaY = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setTranslateY(0);
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const startDrag = (y: number) => { dragStartY.current = y; setDragging(true); };
  const moveDrag = (y: number) => {
    if (!dragging) return;
    const d = Math.max(0, y - dragStartY.current);
    dragDeltaY.current = d;
    setTranslateY(d);
  };
  const endDrag = () => {
    setDragging(false);
    if (dragDeltaY.current > 90) { onClose(); } else { setTranslateY(0); }
    dragDeltaY.current = 0;
  };

  const heightCls = { auto: 'max-h-[92dvh]', half: 'h-[52dvh]', tall: 'h-[78dvh]', full: 'h-[96dvh]' }[height];

  if (!mounted) return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-50 flex items-end', !open && 'pointer-events-none')}>
      {/* backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      {/* sheet */}
      <div
        style={{ transform: `translateY(${open ? translateY : '100%'}px)` }}
        className={cn(
          'relative w-full bg-white rounded-t-[22px] shadow-2xl flex flex-col safe-area-bottom',
          !dragging && 'transition-transform duration-300 ease-out',
          heightCls,
          className,
        )}
      >
        {/* drag handle zone */}
        <div
          className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing select-none flex-shrink-0"
          onMouseDown={(e) => startDrag(e.clientY)}
          onMouseMove={(e) => moveDrag(e.clientY)}
          onMouseUp={endDrag}
          onTouchStart={(e) => startDrag(e.touches[0].clientY)}
          onTouchMove={(e) => { e.preventDefault(); moveDrag(e.touches[0].clientY); }}
          onTouchEnd={endDrag}
        >
          <div className="w-9 h-1 bg-gray-300 rounded-full" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
            <h3 className="font-bold text-gray-900 text-[15px]">{title}</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors active:scale-95"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
