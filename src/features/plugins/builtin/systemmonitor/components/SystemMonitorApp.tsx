import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SystemMonitorDashboard } from './SystemMonitorDashboard';
import { logger } from '../../../../../shared/utils/logger';
export function SystemMonitorApp(): React.JSX.Element {
  return (
    <SystemMonitorDashboard
      onClose={() => {
        void getCurrentWindow()
          .close()
          .catch((error: unknown) => logger.error('System monitor close failed:', error));
      }}
    />
  );
}
