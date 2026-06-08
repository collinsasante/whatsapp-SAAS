'use client';
import { create } from 'zustand';

interface ConfirmState {
  isOpen: boolean;
  message: string;
  subtext?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: ((v: boolean) => void) | null;
  show: (opts: { message: string; subtext?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  onConfirm: () => void;
  onCancel: () => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  isOpen: false,
  message: '',
  resolve: null,

  show: ({ message, subtext, confirmLabel, danger }) =>
    new Promise<boolean>((resolve) => {
      set({ isOpen: true, message, subtext, confirmLabel, danger, resolve });
    }),

  onConfirm: () => {
    get().resolve?.(true);
    set({ isOpen: false, resolve: null });
  },

  onCancel: () => {
    get().resolve?.(false);
    set({ isOpen: false, resolve: null });
  },
}));

export function showConfirm(message: string, opts?: { subtext?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return useConfirmStore.getState().show({ message, ...opts });
}
