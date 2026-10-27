import React, { useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';
import { VOLT_EVENTS, onVoltEvent } from '../../../../../shared/events';
import { SystemMonitorDashboard } from './SystemMonitorDashboard';
import '../system-monitor.css';
export function SystemMonitorDetail(): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => onVoltEvent(VOLT_EVENTS.OPEN_SYSTEM_MONITOR, () => setIsOpen(true)), []);
  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sm-modal-backdrop" />
        <Dialog.Popup className="sm-modal">
          <Dialog.Title className="sm-sr-only">{t('detailTitle')}</Dialog.Title>
          <SystemMonitorDashboard enabled={isOpen} onClose={() => setIsOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
