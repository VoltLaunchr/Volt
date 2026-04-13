import { useTranslation } from 'react-i18next';
import { applicationService } from '../../features/applications/services/applicationService';
import { ContextMenu } from '../../shared/components/ui';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
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

  return (
    <ContextMenu
      isOpen={state.isOpen}
      position={state.position}
      actions={[
        {
          id: 'launch',
          label: t('contextMenu.launch'),
          icon: '🚀',
          shortcut: t('shortcuts.enter'),
          onClick: () => {
            if (state.result) onLaunch(state.result);
          },
        },
        {
          id: 'open-location',
          label: t('contextMenu.openFolder'),
          icon: '📁',
          onClick: () => {
            if (state.result) {
              applicationService.launchApplication(getDirectoryPath(pathOf(state.result)));
            }
          },
        },
        {
          id: 'copy-path',
          label: t('contextMenu.copyPath'),
          icon: '📋',
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
          icon: 'ℹ️',
          onClick: () => {
            if (state.result) onShowProperties(state.result);
          },
        },
      ]}
      onClose={onClose}
    />
  );
}
