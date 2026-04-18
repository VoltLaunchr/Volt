/**
 * Permission Consent Dialog
 *
 * Shows when an extension requires permissions that haven't been granted yet.
 * The user can grant all requested permissions or deny (skip loading the extension).
 */

import { Shield, Clipboard, Globe, Bell, ExternalLink } from 'lucide-react';
import { Modal } from '../../../shared/components/ui';
import { logger } from '../../../shared/utils/logger';
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
  network: {
    label: 'Network',
    description: 'Make HTTP requests to external services',
    icon: <Globe size={18} />,
  },
  notifications: {
    label: 'Notifications',
    description: 'Show desktop notifications',
    icon: <Bell size={18} />,
  },
  openUrl: {
    label: 'Open URLs',
    description: 'Open links in your default browser',
    icon: <ExternalLink size={18} />,
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
            if (!info) {
              // Upstream (ExtensionLoader.sanitizePermissions) guarantees every
              // entry is a known ExtensionPermission, so this branch is
              // effectively unreachable. If it ever fires, a new permission was
              // added to the type without a matching PERMISSION_INFO entry —
              // surface that loudly instead of silently hiding it from users.
              logger.error(
                '[PermissionDialog] Missing PERMISSION_INFO entry for permission:',
                perm
              );
              return null;
            }
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
