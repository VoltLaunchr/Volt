import React, { useEffect, useRef } from 'react';
import './ContextMenu.css';

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
      className="context-menu"
      role="menu"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {actions.map((action) => {
        if (action.separator) {
          return <div key={action.id} className="context-menu-separator" role="separator" />;
        }

        return (
          <button
            key={action.id}
            className="context-menu-item"
            role="menuitem"
            onClick={() => {
              if (!action.disabled) {
                action.onClick();
                onClose();
              }
            }}
            disabled={action.disabled}
          >
            {action.icon && <span className="context-menu-icon">{action.icon}</span>}
            <span className="context-menu-label">{action.label}</span>
            {action.shortcut && <span className="context-menu-shortcut">{action.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
};
