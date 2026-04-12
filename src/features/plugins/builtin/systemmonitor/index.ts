import { invoke } from '@tauri-apps/api/core';
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
    const query = context.query.toLowerCase().trim();
    const keywords = ['cpu', 'memory', 'ram', 'disk', 'system', 'performance', 'usage'];
    return keywords.some((kw) => query.includes(kw));
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const query = context.query.toLowerCase().trim();

    try {
      const metrics = await invoke<SystemMetrics>('get_system_metrics');
      const results: PluginResult[] = [];

      // CPU result
      if (query.includes('cpu') || query.includes('system') || query.includes('performance')) {
        results.push({
          id: 'system_cpu',
          type: PluginResultType.SystemMonitor,
          title: `CPU ${metrics.cpuUsage.toFixed(1)}%`,
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
      if (
        query.includes('memory') ||
        query.includes('ram') ||
        query.includes('system') ||
        query.includes('performance')
      ) {
        const availableGb = metrics.memoryTotalGb - metrics.memoryUsedGb;
        results.push({
          id: 'system_memory',
          type: PluginResultType.SystemMonitor,
          title: `Memory ${metrics.memoryUsedGb.toFixed(1)} / ${metrics.memoryTotalGb.toFixed(1)} GB`,
          subtitle: `${availableGb.toFixed(1)} GB available • ${this.getUsageLabel(metrics.memoryUsage)}`,
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
      if (query.includes('disk') || query.includes('system') || query.includes('performance')) {
        const availableGb = metrics.diskTotalGb - metrics.diskUsedGb;
        results.push({
          id: 'system_disk',
          type: PluginResultType.SystemMonitor,
          title: `Disk ${metrics.diskUsedGb.toFixed(0)} / ${metrics.diskTotalGb.toFixed(0)} GB`,
          subtitle: `${availableGb.toFixed(0)} GB free • ${this.getUsageLabel(metrics.diskUsage)}`,
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
    const metrics = result.data?.metrics as SystemMetrics;
    if (!metrics) return;

    // Copy detailed metrics to clipboard
    const summary = [
      '═══ System Performance ═══',
      '',
      `CPU:    ${metrics.cpuUsage.toFixed(1)}%`,
      `Memory: ${metrics.memoryUsedGb.toFixed(1)} / ${metrics.memoryTotalGb.toFixed(1)} GB (${metrics.memoryUsage.toFixed(1)}%)`,
      `Disk:   ${metrics.diskUsedGb.toFixed(0)} / ${metrics.diskTotalGb.toFixed(0)} GB (${metrics.diskUsage.toFixed(1)}%)`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      console.log('✓ System metrics copied to clipboard');
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
   * Get usage status label
   */
  private getUsageLabel(usage: number): string {
    if (usage >= 90) return 'Critical usage';
    if (usage >= 75) return 'High usage';
    if (usage >= 50) return 'Moderate usage';
    return 'Normal';
  }
}

export { SystemMetricBadge } from './components/SystemMetricBadge';
export { CpuIcon, MemoryIcon, DiskIcon } from './icons';
