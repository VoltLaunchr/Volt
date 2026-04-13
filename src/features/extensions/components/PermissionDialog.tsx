/**
 * Permission Consent Dialog
 *
 * Shows when an extension requires permissions that haven't been granted yet.
 * The user can grant all requested permissions or deny (skip loading the extension).
 */

import { Shield, Clipboard, HardDrive, Globe, Terminal, Bell } from 'lucide-react';
import { Modal } from '../../../shared/components/ui';
import type { ExtensionPermission } from '../types/extension.types';
import './PermissionDialog.css';

const PERMISSION_INFO: Record<
  ExtensionPermission,
  { label: string; description: string; icon: React.ReactNode }
> = {
  clipboard: {
    label: 'Clipboard',
    description: 'Read and write to the system clipboard',
    icon: <Clipboard size={18} />,
  },
  filesystem: {
    label: 'File System',
    description: 'Read files on your computer',
    icon: <HardDrive size={18} />,
  },
  network: {
    label: 'Network',
    description: 'Make HTTP requests to external services',
    icon: <Globe size={18} />,
  },
  shell: {
    label: 'Shell',
    description: 'Execute system commands',
    icon: <Terminal size={18} />,
  },
  notifications: {
    label: 'Notifications',
    description: 'Show desktop notifications',
    icon: <Bell size={18} />,
  },
};

interface PermissionDialogProps {
  isOpen: boolean;
  extensionName: string;
  permissions: ExtensionPermission[];
  onGrant: () => void;
  onDeny: () => void;
}

export function PermissionDialog({
  isOpen,
  extensionName,
  permissions,
  onGrant,
  onDeny,
}: PermissionDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onDeny} title="Extension Permissions">
      <div className="permission-dialog">
        <div className="permission-header">
          <Shield size={24} />
          <p>
            <strong>{extensionName}</strong> requests the following permissions:
          </p>
        </div>

        <ul className="permission-list">
          {permissions.map((perm) => {
            const info = PERMISSION_INFO[perm];
            if (!info) return null;
            return (
              <li key={perm} className="permission-item">
                <span className="permission-icon">{info.icon}</span>
                <div className="permission-info">
                  <span className="permission-label">{info.label}</span>
                  <span className="permission-desc">{info.description}</span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="permission-actions">
          <button className="permission-btn permission-btn-deny" onClick={onDeny}>
            Deny
          </button>
          <button className="permission-btn permission-btn-grant" onClick={onGrant}>
            Grant Permissions
          </button>
        </div>
      </div>
    </Modal>
  );
}
