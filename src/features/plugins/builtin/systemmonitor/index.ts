
import { invoke } from '@tauri-apps/api/core';
import i18n from 'i18next';
import { logger } from '../../../../shared/utils/logger';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  memoryTotalGb: number;
  memoryUsedGb: number;
  diskTotalGb: number;
  diskUsedGb: number;
}

const SYSTEMMONITOR_NS = 'systemmonitor';

const CPU_KEYWORDS = ['cpu'];
const MEMORY_KEYWORDS = ['memory', 'ram', 'mémoire'];
const DISK_KEYWORDS = ['disk', 'disque'];
const GENERIC_KEYWORDS = ['system', 'système', 'performance', 'usage', 'utilisation'];

const ALL_KEYWORDS = [
  ...CPU_KEYWORDS,
  ...MEMORY_KEYWORDS,
  ...DISK_KEYWORDS,
  ...GENERIC_KEYWORDS,
];

/**
 * Word-boundary keyword match. Splits the query on whitespace and checks whether
 * any whole token matches a keyword, so `"scpurgatory"` and `"occupy"` no longer
 * falsely trigger on `"cpu"`.
 */
function hasKeyword(query: string, keywords: readonly string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return keywords.some((kw) => words.includes(kw));
}

/**
 * System Monitor Plugin
 * Professional system monitoring with custom UI
 */
export class SystemMonitorPlugin implements Plugin {
  id = 'system_monitor';
  name = 'System Monitor';
  description = 'Monitor system resources (CPU, memory, disk)';
  enabled = true;

  canHandle(context: PluginContext): boolean {
    return hasKeyword(context.query.trim(), ALL_KEYWORDS);
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.trim();

    try {
      const metrics = await invoke<SystemMetrics>('get_system_metrics');
      const results: PluginResult[] = [];

      const matchesGeneric = hasKeyword(query, GENERIC_KEYWORDS);

      // CPU result
      if (hasKeyword(query, CPU_KEYWORDS) || matchesGeneric) {
        results.push({
          id: 'system_cpu',
          type: PluginResultType.SystemMonitor,
          title: `${i18n.t('cpu', { ns: SYSTEMMONITOR_NS })} ${metrics.cpuUsage.toFixed(1)}%`,
          subtitle: this.getUsageLabel(metrics.cpuUsage),
          score: 95,
          data: {
            type: 'cpu',
            value: metrics.cpuUsage,
            metrics,
            color: this.getUsageColor(metrics.cpuUsage),
          },
        });
      }

      // Memory result
      if (hasKeyword(query, MEMORY_KEYWORDS) || matchesGeneric) {
        const availableGb = metrics.memoryTotalGb - metrics.memoryUsedGb;
        const availableLabel = i18n.t('available', {
          ns: SYSTEMMONITOR_NS,
          value: availableGb.toFixed(1),
        });
        results.push({
          id: 'system_memory',
          type: PluginResultType.SystemMonitor,
          title: `${i18n.t('memory', { ns: SYSTEMMONITOR_NS })} ${metrics.memoryUsedGb.toFixed(1)} / ${metrics.memoryTotalGb.toFixed(1)} GB`,
          subtitle: `${availableLabel} • ${this.getUsageLabel(metrics.memoryUsage)}`,
          score: 95,
          data: {
            type: 'memory',
            value: metrics.memoryUsage,
            metrics,
            color: this.getUsageColor(metrics.memoryUsage),
          },
        });
      }

      // Disk result
      if (hasKeyword(query, DISK_KEYWORDS) || matchesGeneric) {
        const availableGb = metrics.diskTotalGb - metrics.diskUsedGb;
        const freeLabel = i18n.t('free', {
          ns: SYSTEMMONITOR_NS,
          value: availableGb.toFixed(0),
        });
        results.push({
          id: 'system_disk',
          type: PluginResultType.SystemMonitor,
          title: `${i18n.t('disk', { ns: SYSTEMMONITOR_NS })} ${metrics.diskUsedGb.toFixed(0)} / ${metrics.diskTotalGb.toFixed(0)} GB`,
          subtitle: `${freeLabel} • ${this.getUsageLabel(metrics.diskUsage)}`,
          score: 95,
          data: {
            type: 'disk',
            value: metrics.diskUsage,
            metrics,
            color: this.getUsageColor(metrics.diskUsage),
          },
        });
      }

      return results;
    } catch (error) {
      logger.error('Failed to get system metrics:', error);
      return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    // Primary action: open the detail modal. The SystemMonitorDetail component
    // mounted at App.tsx listens for this event and toggles its open state.
    window.dispatchEvent(new CustomEvent('volt:openSystemMonitor'));

    // Secondary: if the caller opted into the clipboard fallback via
    // result.data.copyToClipboard, keep the old summary behaviour so power
    // users can still script it from context menus / alternate actions.
    if (!result.data?.copyToClipboard) return;

    const metrics = result.data?.metrics as SystemMetrics | undefined;
    if (!metrics) return;

    const title = i18n.t('clipboardTitle', { ns: SYSTEMMONITOR_NS });
    const cpuLabel = i18n.t('cpu', { ns: SYSTEMMONITOR_NS });
    const memLabel = i18n.t('memory', { ns: SYSTEMMONITOR_NS });
    const diskLabel = i18n.t('disk', { ns: SYSTEMMONITOR_NS });

    const summary = [
      `═══ ${title} ═══`,
      '',
      `${cpuLabel}:    ${metrics.cpuUsage.toFixed(1)}%`,
      `${memLabel}: ${metrics.memoryUsedGb.toFixed(1)} / ${metrics.memoryTotalGb.toFixed(1)} GB (${metrics.memoryUsage.toFixed(1)}%)`,
      `${diskLabel}:   ${metrics.diskUsedGb.toFixed(0)} / ${metrics.diskTotalGb.toFixed(0)} GB (${metrics.diskUsage.toFixed(1)}%)`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      logger.info('System metrics copied to clipboard');
    } catch (error) {
      logger.error('Failed to copy to clipboard:', error);
    }
  }

  /**
   * Get usage status color
   */
  private getUsageColor(usage: number): string {
    if (usage >= 90) return '#ef4444'; // red
    if (usage >= 75) return '#f97316'; // orange
    if (usage >= 50) return '#f59e0b'; // amber
    return '#10b981'; // green
  }

  /**
   * Get localized usage status label
   */
  private getUsageLabel(usage: number): string {
    const key = usage >= 90 ? 'critical' : usage >= 75 ? 'high' : usage >= 50 ? 'moderate' : 'normal';
    return i18n.t(`usage.${key}`, { ns: SYSTEMMONITOR_NS });
  }
}

export { SystemMetricBadge } from './components/SystemMetricBadge';
export { SystemMonitorDetail } from './components/SystemMonitorDetail';
export { CpuIcon, MemoryIcon, DiskIcon } from './icons';
