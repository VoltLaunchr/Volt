import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export interface AlertDialogProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AlertDialog({ isOpen, message, onConfirm, onCancel }: AlertDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onConfirm, onCancel]);

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Confirm">
      <div className="py-2">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle size={20} className="shrink-0 text-accent-red mt-0.5" />
          <p className="m-0 text-sm leading-relaxed text-body">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-sm border-0 text-sm font-medium cursor-pointer transition-opacity bg-surface-elevated text-on-dark hover:opacity-85"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-sm border-0 text-sm font-medium cursor-pointer transition-opacity bg-accent-blue text-white hover:opacity-85"
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </Modal>
  );
}
