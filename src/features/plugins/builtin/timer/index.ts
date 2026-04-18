
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { timerStore } from './timerStore';

// ── Duration parsing ──────────────────────────────────────────────────────────

/** Maximum timer duration: 24 hours */
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/** Unit aliases mapped to their multiplier in ms */
const UNIT_MAP: Record<string, number> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
};

/**
 * Parse a flexible duration string into milliseconds.
 * Supports: "5m", "5 min", "5minutes", "1h30m", "1h 30m", "90", "1:30", "1:30:00"
 * Returns null if unparsable or exceeds MAX_DURATION_MS.
 */
export function parseDurationFlexible(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // Colon format: "1:30" (m:s) or "1:30:00" (h:m:s)
  const colonMatch = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    const parts = colonMatch.slice(1).filter(Boolean).map(Number);
    let ms: number;
    if (parts.length === 2) {
      ms = parts[0] * 60_000 + parts[1] * 1000;
    } else {
      ms = parts[0] * 3_600_000 + parts[1] * 60_000 + parts[2] * 1000;
    }
    return ms > 0 && ms <= MAX_DURATION_MS ? ms : null;
  }

  // Compound format: "1h30m", "1h 30m 10s", "5m30s"
  const compoundRegex = /(\d+)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?)/g;
  let total = 0;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = compoundRegex.exec(s)) !== null) {
    found = true;
    const value = parseInt(match[1], 10);
    const multiplier = UNIT_MAP[match[2]];
    if (!multiplier) return null;
    total += value * multiplier;
  }

  if (found && total > 0) {
    return total <= MAX_DURATION_MS ? total : null;
  }

  // Bare number → treat as minutes
  if (/^\d+$/.test(s)) {
    const ms = parseInt(s, 10) * 60_000;
    return ms > 0 && ms <= MAX_DURATION_MS ? ms : null;
  }

  return null;
}

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

    // Try to extract duration from "timer <duration> [label]" or "countdown <duration> [label]"
    const prefixMatch = lower.match(/^(?:timer|countdown)\s+(.+)$/);
    const parsed = prefixMatch ? this.parseTimerInput(prefixMatch[1]) : null;

    if (parsed) {
      const { duration, label } = parsed;

      // Show active timers that can be cancelled above the new-timer result
      this.addActiveTimerResults(results);

      results.push({
        id: `timer-${Date.now()}`,
        type: PluginResultType.Timer,
        title: `⏱️ Start ${this.formatDuration(duration)} Timer`,
        subtitle: `${label} - Press Enter to start`,
        score: 100,
        data: {
          action: 'start',
          duration,
          label,
        },
        pluginId: this.id,
      });
    }
    // Pomodoro presets
    else if (lower === 'pomodoro' || lower.startsWith('pomodoro')) {
      results.push(
        {
          id: 'pomodoro-open-view',
          type: PluginResultType.Timer,
          title: '🍅 Open Focus Timer',
          subtitle: 'Full Pomodoro view with tasks, sessions & controls',
          score: 110,
          data: { action: 'open-view' },
          pluginId: this.id,
        },
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
    // Quick timer suggestions (also show active timers)
    else if (lower === 'timer' || lower === 'countdown') {
      // Show active timers first so user can cancel them
      this.addActiveTimerResults(results);

      results.push(
        {
          id: 'timer-1m',
          type: PluginResultType.Timer,
          title: '⏱️ 1 Minute Timer',
          subtitle: 'Quick 60 second countdown',
          score: 80,
          data: { action: 'start', duration: 60 * 1000, label: '1 Minute' },
          pluginId: this.id,
        },
        {
          id: 'timer-5m',
          type: PluginResultType.Timer,
          title: '⏱️ 5 Minutes Timer',
          subtitle: 'Short break timer',
          score: 75,
          data: { action: 'start', duration: 5 * 60 * 1000, label: '5 Minutes' },
          pluginId: this.id,
        },
        {
          id: 'timer-10m',
          type: PluginResultType.Timer,
          title: '⏱️ 10 Minutes Timer',
          subtitle: 'Medium duration timer',
          score: 70,
          data: { action: 'start', duration: 10 * 60 * 1000, label: '10 Minutes' },
          pluginId: this.id,
        },
        {
          id: 'timer-25m',
          type: PluginResultType.Timer,
          title: '🍅 25 Minutes (Pomodoro)',
          subtitle: 'Standard Pomodoro work session',
          score: 65,
          data: { action: 'start', duration: 25 * 60 * 1000, label: 'Pomodoro' },
          pluginId: this.id,
        },
      );
    }

    return results;
  }

  async execute(result: PluginResult): Promise<void> {
    const data = result.data as { action: string; duration?: number; label?: string; timerId?: string };

    if (data.action === 'open-view') {
      window.dispatchEvent(new CustomEvent('volt:open-timer'));
      return;
    }

    if (data.action === 'cancel' && data.timerId) {
      timerStore.cancelTimer(data.timerId);
      return;
    }

    if (data.action === 'start' && data.duration && data.label) {
      timerStore.startTimer(data.duration, data.label);
    }
  }

  /**
   * Parse "5m label text" or "1h30m work session" etc.
   * Splits the input into the duration portion and the optional label.
   */
  private parseTimerInput(input: string): { duration: number; label: string } | null {
    // Try to peel off progressively shorter prefixes as duration.
    // Start from shortest (1 word) so that "1h30m work session" matches
    // "1h30m" as duration and "work session" as label.
    const words = input.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const durationPart = words.slice(0, i).join(' ');
      const labelPart = words.slice(i).join(' ');
      const ms = parseDurationFlexible(durationPart);
      if (ms !== null) {
        return { duration: ms, label: labelPart };
      }
    }

    // Try parsing the whole string as a duration (no label)
    const full = parseDurationFlexible(input);
    if (full !== null) return { duration: full, label: 'Timer' };

    return null;
  }

  /** Add active timer results with cancel action, scored above presets */
  private addActiveTimerResults(results: PluginResult[]): void {
    const active = timerStore.getActiveTimers();
    for (let i = 0; i < active.length; i++) {
      const timer = active[i];
      const remaining = timerStore.getRemainingTime(timer.id);
      results.push({
        id: `timer-active-${timer.id}`,
        type: PluginResultType.Timer,
        title: `${timer.isPaused ? '⏸' : '⏱️'} ${timer.label} — ${timerStore.formatDuration(remaining)} left`,
        subtitle: 'Press Enter to cancel',
        score: 110 - i,
        data: { action: 'cancel', timerId: timer.id },
        pluginId: this.id,
      });
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainMinutes = minutes % 60;
      return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Re-export components and hooks
export { TimerDisplay } from './TimerDisplay';
export { TimerView } from './TimerView';
export { useTimers } from './useTimers';
export { timerStore } from './timerStore';
export { tasksStore } from './tasksStore';
export type { ActiveTimer } from './timerStore';
export type { PomodoroTask } from './tasksStore';
