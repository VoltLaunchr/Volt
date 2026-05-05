import { useEffect } from 'react';
import { CheckCircle, AlertCircle, Info, X, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToastStore, type ToastItem } from './toast-store';

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  const iconClass = {
    info: 'text-accent-blue',
    success: 'text-accent-green',
    error: 'text-accent-red',
    update: 'text-accent-blue',
  }[type];

  switch (type) {
    case 'success':
      return <CheckCircle size={16} className={iconClass} />;
    case 'error':
      return <AlertCircle size={16} className={iconClass} />;
    case 'update':
      return <Download size={16} className={iconClass} />;
    default:
      return <Info size={16} className={iconClass} />;
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
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-md border border-hairline-strong bg-surface-elevated text-body text-sm min-w-[260px] max-w-[400px] shadow-lg"
      role={(toast.dismissable ?? true) ? 'status' : 'alert'}
    >
      <ToastIcon type={toast.type} />
      <span
        className={cn(
          'flex-1 text-body',
          toast.action && 'cursor-pointer hover:text-on-dark underline underline-offset-2'
        )}
        onClick={toast.action}
        role={toast.action ? 'button' : undefined}
        tabIndex={toast.action ? 0 : undefined}
        onKeyDown={
          toast.action
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') toast.action?.();
              }
            : undefined
        }
      >
        {toast.message}
      </span>
      {(toast.dismissable ?? true) && (
        <button
          className="text-mute hover:text-on-dark transition-colors ml-1 shrink-0 cursor-pointer"
          onClick={() => removeToast(toast.id)}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[3000] flex flex-col gap-2 items-center"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
