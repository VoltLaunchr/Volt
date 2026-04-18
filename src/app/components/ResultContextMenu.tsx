import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { applicationService } from '../../features/applications/services/applicationService';
import { ContextMenu } from '../../shared/components/ui';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import type { ShellOutputData } from '../../features/plugins/builtin/shell';
import { getDirectoryPath } from '../utils';

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  result: SearchResult | null;
}

interface ResultContextMenuProps {
  state: ContextMenuState;
  onLaunch: (result: SearchResult) => void;
  onShowProperties: (result: SearchResult) => void;
  onClose: () => void;
}

const pathOf = (result: SearchResult): string =>
  result.type === SearchResultType.File
    ? (result.data as FileInfo).path
    : (result.data as AppInfo).path;

export function ResultContextMenu({
  state,
  onLaunch,
  onShowProperties,
  onClose,
}: ResultContextMenuProps) {
  const { t } = useTranslation('results');

  const isShellCommand = state.result?.type === SearchResultType.ShellCommand;

  const shellActions = () => {
    const shellData = state.result?.data as unknown as ShellOutputData | undefined;
    const command = shellData?.command || '';
    const hasOutput = shellData?.status === 'done' && !!(shellData.stdout || shellData.stderr);

    return [
      {
        id: 'run',
        label: 'Run',
        icon: '\u25b6\ufe0f',
        shortcut: 'Enter',
        onClick: () => {
          if (state.result) onLaunch(state.result);
        },
      },
      {
        id: 'copy-command',
        label: 'Copy Command',
        icon: '\ud83d\udccb',
        onClick: () => {
          if (command) navigator.clipboard.writeText(command);
        },
      },
      ...(hasOutput
        ? [
            {
              id: 'copy-output',
              label: 'Copy Output',
              icon: '\ud83d\udcc4',
              onClick: () => {
                const output = shellData?.stdout || shellData?.stderr || '';
                navigator.clipboard.writeText(output);
              },
            },
          ]
        : []),
      {
        id: 'rerun',
        label: 'Re-run',
        icon: '\ud83d\udd04',
        onClick: () => {
          if (state.result) onLaunch(state.result);
        },
      },
      {
        id: 'separator-shell',
        label: '',
        onClick: () => {},
        separator: true,
      },
      {
        id: 'pin-command',
        label: 'Pin Command',
        icon: '\ud83d\udccc',
        onClick: () => {
          if (command) {
            invoke('pin_shell_command', { command }).catch(() => {});
          }
        },
      },
    ];
  };

  const defaultActions = [
    {
      id: 'launch',
      label: t('contextMenu.launch'),
      icon: '\ud83d\ude80',
      shortcut: t('shortcuts.enter'),
      onClick: () => {
        if (state.result) onLaunch(state.result);
      },
    },
    {
      id: 'open-location',
      label: t('contextMenu.openFolder'),
      icon: '\ud83d\udcc1',
      onClick: () => {
        if (state.result) {
          applicationService.launchApplication(getDirectoryPath(pathOf(state.result)));
        }
      },
    },
    {
      id: 'copy-path',
      label: t('contextMenu.copyPath'),
      icon: '\ud83d\udccb',
      onClick: () => {
        if (state.result) {
          navigator.clipboard.writeText(pathOf(state.result));
        }
      },
    },
    {
      id: 'separator1',
      label: '',
      onClick: () => {},
      separator: true,
    },
    {
      id: 'properties',
      label: t('contextMenu.properties'),
      icon: '\u2139\ufe0f',
      onClick: () => {
        if (state.result) onShowProperties(state.result);
      },
    },
  ];

  return (
    <ContextMenu
      isOpen={state.isOpen}
      position={state.position}
      actions={isShellCommand ? shellActions() : defaultActions}
      onClose={onClose}
    />
  );
}
