import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'error' | 'update';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: () => void;
  /** When false the dismiss (X) button is hidden. Defaults to true. */
  dismissable?: boolean;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (message: string, type?: ToastType, duration?: number, action?: () => void, dismissable?: boolean) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],

  addToast: (message, type = 'info', duration = 5000, action?, dismissable = true) => {
    const id = `toast-${++toastCounter}`;
    set((state) => {
      const newToasts = [...state.toasts, { id, message, type, duration, action, dismissable }];
      // Keep max 3 toasts
      return { toasts: newToasts.slice(-3) };
    });
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

/** Convenience hook for showing toasts. */
export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  return { showToast: addToast };
}
