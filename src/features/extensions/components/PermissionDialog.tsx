/**
 * Permission Consent Dialog
 *
 * Shows when an extension requires permissions that haven't been granted yet.
 * The user can grant all requested permissions or deny (skip loading the extension).
 */

import { Shield, Clipboard, Globe, Bell, ExternalLink, KeyRound, BrainCircuit, FolderOpen } from 'lucide-react';
import { Modal } from '../../../shared/components/ui';
import { logger } from '../../../shared/utils/logger';
import type { ExtensionPermission } from '../types/extension.types';

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
  oauth: {
    label: 'OAuth Login',
    description: 'Authenticate with third-party services via OAuth (PKCE)',
    icon: <KeyRound size={18} />,
  },
  ai: {
    label: 'AI Inference',
    description: 'Call AI models using an API key you configure in extension settings',
    icon: <BrainCircuit size={18} />,
  },
  system: {
    label: 'System Access',
    description: 'List installed applications, reveal files in Finder / Explorer, move files to Trash',
    icon: <FolderOpen size={18} />,
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
      <div className="py-2">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <Shield size={24} className="shrink-0 text-accent-blue mt-0.5" />
          <p className="m-0 text-sm leading-relaxed text-body">
            <strong className="text-on-dark">{extensionName}</strong> requests the following permissions:
          </p>
        </div>

        {/* Permission list */}
        <ul className="list-none p-0 m-0 mb-5 flex flex-col gap-2">
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
              <li
                key={perm}
                className="flex items-start gap-2.5 py-2 px-3 rounded-md bg-surface-elevated"
              >
                <span className="flex items-center text-accent-blue shrink-0 mt-0.5">
                  {info.icon}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-on-dark">{info.label}</span>
                  <span className="text-xs text-mute">{info.description}</span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-sm border-0 text-sm font-medium cursor-pointer transition-opacity bg-surface-elevated text-on-dark hover:opacity-85"
            onClick={onDeny}
          >
            Deny
          </button>
          <button
            className="px-4 py-2 rounded-sm border-0 text-sm font-medium cursor-pointer transition-opacity bg-accent-blue text-white hover:opacity-85"
            onClick={onGrant}
          >
            Grant Permissions
          </button>
        </div>
      </div>
    </Modal>
  );
}
