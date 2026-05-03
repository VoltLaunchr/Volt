import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  actions: ContextMenuAction[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ isOpen, position, actions, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[1000] min-w-[180px] bg-surface-card border border-hairline-strong rounded-md py-1 shadow-2xl outline-none"
      role="menu"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {actions.map((action) => {
        if (action.separator) {
          return <div key={action.id} className="my-1 mx-2 h-px bg-hairline" role="separator" />;
        }

        return (
          <button
            key={action.id}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm mx-1 w-[calc(100%-8px)]',
              action.disabled
                ? 'text-mute cursor-not-allowed'
                : 'text-body hover:bg-surface-elevated hover:text-on-dark cursor-pointer transition-colors'
            )}
            role="menuitem"
            onClick={() => {
              if (!action.disabled) {
                action.onClick();
                onClose();
              }
            }}
            disabled={action.disabled}
          >
            {action.icon && <span className="text-base">{action.icon}</span>}
            <span className="flex-1">{action.label}</span>
            {action.shortcut && <span className="text-xs text-mute ml-auto">{action.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
};
