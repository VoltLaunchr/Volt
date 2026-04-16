import { useEffect } from 'react';
import { create } from 'zustand';
import { CheckCircle, AlertCircle, Info, X, Download } from 'lucide-react';
import './Toast.css';

export type ToastType = 'info' | 'success' | 'error' | 'update';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: () => void;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (message: string, type?: ToastType, duration?: number, action?: () => void) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],

  addToast: (message, type = 'info', duration = 5000, action?) => {
    const id = `toast-${++toastCounter}`;
    set((state) => {
      const newToasts = [...state.toasts, { id, message, type, duration, action }];
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

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  switch (type) {
    case 'success':
      return <CheckCircle size={16} />;
    case 'error':
      return <AlertCircle size={16} />;
    case 'update':
      return <Download size={16} />;
    default:
      return <Info size={16} />;
  }
}

function ToastEntry({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);

  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => removeToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, removeToast]);

  return (
    <div className={`toast toast-${toast.type}`} role="status">
      <ToastIcon type={toast.type} />
      <span
        className={`toast-message${toast.action ? ' toast-message-clickable' : ''}`}
        onClick={toast.action}
        role={toast.action ? 'button' : undefined}
        tabIndex={toast.action ? 0 : undefined}
        onKeyDown={toast.action ? (e) => { if (e.key === 'Enter' || e.key === ' ') toast.action?.(); } : undefined}
      >
        {toast.message}
      </span>
      <button
        className="toast-close"
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
