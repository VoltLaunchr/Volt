import { Dialog } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'small' | 'medium' | 'large';
}

export function Modal({ isOpen, onClose, title, children, size = 'medium' }: ModalProps) {
  const sizeClass = {
    small: 'w-80 max-h-[60vh]',
    medium: 'w-[480px] max-h-[70vh]',
    large: 'w-[640px] max-h-[80vh]',
  }[size];

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000]" />
        <Dialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'bg-surface border border-hairline rounded-lg shadow-2xl outline-none',
            'overflow-hidden flex flex-col z-[2001]',
            sizeClass
          )}
        >
          {title && (
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
              <Dialog.Title className="text-base font-medium text-ink">{title}</Dialog.Title>
              <Dialog.Close className="text-mute hover:text-on-dark transition-colors p-1 rounded-sm -mr-1 cursor-pointer text-lg leading-none">
                ×
              </Dialog.Close>
            </div>
          )}
          <div className="px-5 py-4 overflow-y-auto">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
