import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcessInfo } from '../types';
import { ProcessChart } from './ResourceCharts';
const percent = (value: number) => `${value.toFixed(1)}%`;
const megabytes = (value: number, unit: string) => `${(value / 1024 / 1024).toFixed(0)} ${unit}`;
export function ProcessPanel({
  processes,
  processSort,
  onSort,
  onStop,
  full = false,
}: {
  processes: ProcessInfo[];
  processSort: 'cpu' | 'memory';
  onSort: (sort: 'cpu' | 'memory') => void;
  onStop: (process: ProcessInfo) => void;
  full?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('systemmonitor');
  const [processView, setProcessView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`sm-panel sm-processes ${full ? 'is-full' : ''}`}>
      <div className="sm-panel-heading">
        <h3>{t('dashboard.processes')}</h3>
        <div className="sm-segment" role="group" aria-label={t('dashboard.processView')}>
          <button aria-pressed={processView === 'chart'} onClick={() => setProcessView('chart')}>
            {t('dashboard.chartView')}
          </button>
          <button aria-pressed={processView === 'table'} onClick={() => setProcessView('table')}>
            {t('dashboard.tableView')}
          </button>
        </div>
      </div>
      <div className="sm-process-tools">
        <label htmlFor="sm-process-sort">{t('dashboard.rankBy')}</label>
        <select
          id="sm-process-sort"
          aria-label={t('dashboard.sortProcesses')}
          value={processSort}
          onChange={(event) => onSort(event.target.value as 'cpu' | 'memory')}
        >
          <option value="cpu">{t('cpu')}</option>
          <option value="memory">{t('memory')}</option>
        </select>
      </div>
      {processView === 'chart' && processes.length > 0 && (
        <ProcessChart processes={processes} sort={processSort} />
      )}
      {processView === 'table' && (
        <div className="sm-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('dashboard.process')}</th>
                <th>PID</th>
                <th>{t('cpu')}</th>
                <th>{t('memory')}</th>
                <th>
                  <span className="sm-sr-only">{t('dashboard.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {processes.slice(0, 5).map((process) => (
                <tr key={process.pid}>
                  <td title={process.name}>{process.name}</td>
                  <td>{process.pid}</td>
                  <td>{percent(process.cpuUsagePercent)}</td>
                  <td>{megabytes(process.memoryBytes, t('dashboard.mb'))}</td>
                  <td>
                    <button
                      className="sm-process-stop"
                      onClick={() => onStop(process)}
                      aria-label={t('dashboard.stopNamed', {
                        name: process.name,
                        pid: process.pid,
                      })}
                    >
                      {t('dashboard.stop')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!processes.length && <p className="sm-panel-empty">{t('dashboard.noProcesses')}</p>}
      {processSort === 'cpu' && <p className="sm-footnote">{t('dashboard.cpuConvention')}</p>}
    </section>
  );
}
