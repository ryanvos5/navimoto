import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, opts?: { type?: ToastType; durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Korte meldingen. Gebruik: useToast.getState().show('Route opgeslagen', { type: 'success' }) */
export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, opts) => {
    const id = nextId++;
    const toast: Toast = { id, message, type: opts?.type ?? 'info' };
    set({ toasts: [...get().toasts, toast].slice(-3) });
    const duration = opts?.durationMs ?? (toast.type === 'error' ? 5000 : 3000);
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
