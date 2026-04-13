import i18n from 'i18next';
import enTimer from './locales/en.json';
import frTimer from './locales/fr.json';
i18n.addResourceBundle('en', 'timer', enTimer);
i18n.addResourceBundle('fr', 'timer', frTimer);

import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { timerStore } from './timerStore';

export class TimerPlugin implements Plugin {
  readonly id = 'timer';
  readonly name = 'Timer & Countdown';
  readonly description = 'Quick timers and Pomodoro countdowns with notifications';
  readonly enabled = true;

  canHandle(context: PluginContext): boolean {
    const lower = context.query.toLowerCase().trim();
    return (
      lower.startsWith('timer ') ||
      lower.startsWith('countdown ') ||
      lower.startsWith('pomodoro') ||
      lower === 'timer' ||
      lower === 'countdown'
    );
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const lower = context.query.toLowerCase().trim();
    const results: PluginResult[] = [];

    // Parse timer command: "timer 5m", "countdown 30s", "timer 25m work"
    const timeMatch = lower.match(/^(timer|countdown)\s+(\d+)(s|m|h)(?:\s+(.+))?$/);

    if (timeMatch) {
      const [, , amount, unit, label] = timeMatch;
      const duration = this.parseDuration(parseInt(amount), unit);
      const labelText = label || 'Timer';

      results.push({
        id: `timer-${Date.now()}`,
        type: PluginResultType.Timer,
        title: `⏱️ Start ${this.formatDuration(duration)} Timer`,
        subtitle: `${labelText} - Click to start`,
        score: 100,
        data: {
          action: 'start',
          duration,
          label: labelText,
        },
        pluginId: this.id,
      });
    }
    // Pomodoro presets
    else if (lower === 'pomodoro' || lower.startsWith('pomodoro')) {
      results.push(
        {
          id: 'pomodoro-work',
          type: PluginResultType.Timer,
          title: '🍅 Pomodoro Work (25 minutes)',
          subtitle: 'Standard Pomodoro work session',
          score: 100,
          data: {
            action: 'start',
            duration: 25 * 60 * 1000,
            label: 'Pomodoro Work',
          },
          pluginId: this.id,
        },
        {
          id: 'pomodoro-break',
          type: PluginResultType.Timer,
          title: '☕ Short Break (5 minutes)',
          subtitle: 'Pomodoro short break',
          score: 95,
          data: {
            action: 'start',
            duration: 5 * 60 * 1000,
            label: 'Short Break',
          },
          pluginId: this.id,
        },
        {
          id: 'pomodoro-long-break',
          type: PluginResultType.Timer,
          title: '🌴 Long Break (15 minutes)',
          subtitle: 'Pomodoro long break',
          score: 90,
          data: {
            action: 'start',
            duration: 15 * 60 * 1000,
            label: 'Long Break',
          },
          pluginId: this.id,
        }
      );
    }
    // Quick timer suggestions
    else if (lower === 'timer' || lower === 'countdown') {
      results.push(
        {
          id: 'timer-1m',
          type: PluginResultType.Timer,
          title: '⏱️ 1 Minute Timer',
          subtitle: 'Quick 60 second countdown',
          score: 100,
          data: {
            action: 'start',
            duration: 60 * 1000,
            label: '1 Minute',
          },
          pluginId: this.id,
        },
        {
          id: 'timer-5m',
          type: PluginResultType.Timer,
          title: '⏱️ 5 Minutes Timer',
          subtitle: 'Short break timer',
          score: 95,
          data: {
            action: 'start',
            duration: 5 * 60 * 1000,
            label: '5 Minutes',
          },
          pluginId: this.id,
        },
        {
          id: 'timer-10m',
          type: PluginResultType.Timer,
          title: '⏱️ 10 Minutes Timer',
          subtitle: 'Medium duration timer',
          score: 90,
          data: {
            action: 'start',
            duration: 10 * 60 * 1000,
            label: '10 Minutes',
          },
          pluginId: this.id,
        },
        {
          id: 'timer-25m',
          type: PluginResultType.Timer,
          title: '🍅 25 Minutes (Pomodoro)',
          subtitle: 'Standard Pomodoro work session',
          score: 85,
          data: {
            action: 'start',
            duration: 25 * 60 * 1000,
            label: 'Pomodoro',
          },
          pluginId: this.id,
        }
      );
    }

    return results;
  }

  async execute(result: PluginResult): Promise<void> {
    const { action, duration, label } = result.data as {
      action: string;
      duration: number;
      label: string;
    };

    if (action === 'start') {
      this.startTimer(duration, label);
    }
  }

  private parseDuration(amount: number, unit: string): number {
    switch (unit) {
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60 * 1000;
      case 'h':
        return amount * 60 * 60 * 1000;
      default:
        return amount * 60 * 1000; // default to minutes
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }

  private startTimer(duration: number, label: string): void {
    // Use the global timer store instead of local state
    timerStore.startTimer(duration, label);
    console.log(`✓ Timer started: ${label} (${this.formatDuration(duration)})`);
  }
}

// Re-export components and hooks
export { TimerDisplay } from './TimerDisplay';
export { useTimers } from './useTimers';
export { timerStore } from './timerStore';
export type { ActiveTimer } from './timerStore';
