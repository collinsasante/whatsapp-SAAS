'use client';
import { useEffect } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useConfirmStore } from '@/store/confirm.store';
import { cn } from '@/lib/utils';

export function ConfirmModal() {
  const { isOpen, message, subtext, confirmLabel, danger, onConfirm, onCancel } = useConfirmStore();

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  const isDanger = danger !== false; // default to danger style

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6">
          <div className={cn(
            'w-12 h-12 rounded-2xl flex items-center justify-center mb-4',
            isDanger ? 'bg-red-50' : 'bg-amber-50',
          )}>
            {isDanger
              ? <Trash2 size={22} className="text-red-500" />
              : <AlertTriangle size={22} className="text-amber-500" />}
          </div>
          <h3 className="text-base font-bold text-gray-900 mb-1">{message}</h3>
          {subtext && <p className="text-sm text-gray-500 leading-relaxed">{subtext}</p>}
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors',
              isDanger ? 'bg-red-500 hover:bg-red-600' : 'bg-teal-600 hover:bg-teal-700',
            )}
          >
            {confirmLabel ?? (isDanger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
