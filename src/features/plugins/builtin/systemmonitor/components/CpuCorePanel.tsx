import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CpuCoreInfo } from '../types';

export function CoreTiles({ cores }: { cores: CpuCoreInfo[] }): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  return (
    <ul className="sm-core-tiles" aria-label={t('perCoreTitle')}>
      {cores.map((core, index) => (
        <li className="sm-core-tile" key={`${core.name}-${index}`} title={core.name}>
          <span>{t('dashboard.coreNumber', { number: index + 1 })}</span>
          <strong>
            {core.usagePercent.toFixed(0)}
            <small>%</small>
          </strong>
          <div className="sm-core-tile-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, core.usagePercent))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
export function CpuCorePanel({ cores }: { cores: CpuCoreInfo[] }): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  return (
    <section className="sm-panel sm-cores sm-cpu">
      <div className="sm-panel-heading">
        <h3>{t('perCoreTitle')}</h3>
        <span>{t('dashboard.logicalCores', { count: cores.length })}</span>
      </div>
      {cores.length ? (
        <CoreTiles cores={cores} />
      ) : (
        <p className="sm-muted">{t('dashboard.noCoreData')}</p>
      )}
      <p className="sm-footnote">{t('dashboard.coreScale')}</p>
    </section>
  );
}
