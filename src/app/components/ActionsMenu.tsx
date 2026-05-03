import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Info,
  Package,
  Pin,
  Play,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { applicationService } from '../../features/applications/services/applicationService';
import type { ShellOutputData } from '../../features/plugins/builtin/shell';
import { Keycap } from '../../shared/components/ui/Keycap';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { getDirectoryPath } from '../utils';

interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcutKeys?: string[];
  onClick: () => void;
  disabled?: boolean;
}

interface Section {
  title?: string;
  actions: Action[];
}

interface ActionsMenuProps {
  isOpen: boolean;
  result: SearchResult | null;
  onLaunch: (result: SearchResult) => void;
  onShowProperties: (result: SearchResult) => void;
  onClose: () => void;
}

const pathOf = (result: SearchResult): string =>
  result.type === SearchResultType.File
    ? (result.data as FileInfo).path
    : (result.data as AppInfo).path;

function ShortcutHint({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5 ml-auto shrink-0">
      {keys.map((k) => (
        <Keycap key={k}>{k}</Keycap>
      ))}
    </div>
  );
}

export function ActionsMenu({ isOpen, result, onLaunch, onShowProperties, onClose }: ActionsMenuProps) {
  const { t } = useTranslation('results');
  const [focusedIndex, setFocusedIndex] = useState(0);

  const sections = useMemo<Section[]>(() => {
    if (!result) return [];

    if (result.type === SearchResultType.ShellCommand) {
      const shellData = result.data as unknown as ShellOutputData | undefined;
      const command = shellData?.command || '';
      const hasOutput = shellData?.status === 'done' && !!(shellData.stdout || shellData.stderr);

      return [
        {
          actions: [
            { id: 'run', label: 'Run', icon: Play, shortcutKeys: ['↵'], onClick: () => onLaunch(result) },
            {
              id: 'copy-command',
              label: 'Copy Command',
              icon: Copy,
              onClick: () => { if (command) navigator.clipboard.writeText(command); },
            },
            ...(hasOutput
              ? [{
                  id: 'copy-output',
                  label: 'Copy Output',
                  icon: FileText,
                  onClick: () => {
                    const output = shellData?.stdout || shellData?.stderr || '';
                    navigator.clipboard.writeText(output);
                  },
                } satisfies Action]
              : []),
            { id: 'rerun', label: 'Re-run', icon: RotateCcw, onClick: () => onLaunch(result) },
          ],
        },
        {
          title: 'Organize',
          actions: [
            {
              id: 'pin-command',
              label: 'Pin Command',
              icon: Pin,
              onClick: () => { if (command) invoke<void>('pin_shell_command', { command }).catch(() => {}); },
            },
          ],
        },
      ];
    }

    const isFileResult = result.type === SearchResultType.File;
    const path = pathOf(result);

    return [
      {
        actions: [
          {
            id: 'launch',
            label: t('contextMenu.launch'),
            icon: ExternalLink,
            shortcutKeys: ['↵'],
            onClick: () => onLaunch(result),
          },
          ...(isFileResult
            ? [{
                id: 'open-with',
                label: 'Open With…',
                icon: Package,
                onClick: () => {
                  invoke<void>('open_file_with_dialog', { path }).catch(() => {});
                  onClose();
                },
              } satisfies Action]
            : []),
          {
            id: 'open-location',
            label: t('contextMenu.openFolder'),
            icon: FolderOpen,
            shortcutKeys: ['Ctrl', 'O'],
            onClick: () => applicationService.launchApplication(getDirectoryPath(path)),
          },
        ],
      },
      {
        title: 'More',
        actions: [
          {
            id: 'copy-path',
            label: t('contextMenu.copyPath'),
            icon: Copy,
            shortcutKeys: ['Ctrl', 'C'],
            onClick: () => navigator.clipboard.writeText(path),
          },
          {
            id: 'properties',
            label: t('contextMenu.properties'),
            icon: Info,
            shortcutKeys: ['Ctrl', 'I'],
            onClick: () => onShowProperties(result),
          },
        ],
      },
    ];
  }, [result, t, onLaunch, onShowProperties, onClose]);

  const allActions = useMemo(() => sections.flatMap((s) => s.actions), [sections]);

  useEffect(() => {
    if (isOpen) setFocusedIndex(0);
  }, [isOpen, result]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setFocusedIndex((prev) => Math.min(prev + 1, allActions.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          e.stopPropagation();
          const action = allActions[focusedIndex];
          if (action && !action.disabled) {
            action.onClick();
            onClose();
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, allActions, focusedIndex, onClose]);

  if (!isOpen || !result) return null;

  let globalIdx = 0;

  return (
    <div className="fixed inset-0 z-[900]" onMouseDown={onClose}>
      <div
        className="absolute right-0 top-[70px] bottom-[32px] w-[260px] bg-surface border-l border-hairline-strong flex flex-col animate-slide-in-right overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        role="menu"
        aria-label="Actions"
      >
        {/* Header */}
        <div className="px-3 pt-3 pb-2.5 border-b border-hairline shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-mute mb-1.5">
            Actions
          </p>
          <p className="text-sm font-medium text-ink truncate leading-snug">{result.title}</p>
          {result.subtitle && (
            <p className="text-xs text-ash truncate mt-0.5">{result.subtitle}</p>
          )}
        </div>

        {/* Actions list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sections.map((section, si) => (
            <div key={section.title ?? `__section_${si}`}>
              {section.title && (
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-stone">
                  {section.title}
                </p>
              )}
              {section.actions.map((action) => {
                const idx = globalIdx++;
                const isFocused = idx === focusedIndex;
                const Icon = action.icon;

                return (
                  <button
                    key={action.id}
                    className={`flex items-center gap-2.5 px-3 py-[7px] w-full text-sm transition-colors ${
                      isFocused
                        ? 'bg-accent-blue-soft text-ink'
                        : 'text-body hover:bg-surface-elevated'
                    }`}
                    role="menuitem"
                    onMouseEnter={() => setFocusedIndex(idx)}
                    onClick={() => {
                      if (!action.disabled) {
                        action.onClick();
                        onClose();
                      }
                    }}
                    disabled={action.disabled}
                  >
                    <Icon
                      size={14}
                      className={isFocused ? 'text-accent-blue shrink-0' : 'text-mute shrink-0'}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1 text-left">{action.label}</span>
                    {action.shortcutKeys && <ShortcutHint keys={action.shortcutKeys} />}
                  </button>
                );
              })}

              {si < sections.length - 1 && (
                <div className="my-1 mx-3 h-px bg-hairline" />
              )}
            </div>
          ))}
        </div>

        {/* Navigation hints */}
        <div className="flex items-center gap-3 px-3 py-2 border-t border-hairline shrink-0">
          <div className="flex items-center gap-1">
            <Keycap>↑</Keycap>
            <Keycap>↓</Keycap>
            <span className="text-[10px] text-stone ml-0.5">navigate</span>
          </div>
          <div className="flex items-center gap-1">
            <Keycap>↵</Keycap>
            <span className="text-[10px] text-stone ml-0.5">select</span>
          </div>
          <div className="flex items-center gap-1">
            <Keycap>Esc</Keycap>
            <span className="text-[10px] text-stone ml-0.5">close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
