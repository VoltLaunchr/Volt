import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TimerPlugin, parseDurationFlexible, MAX_DURATION_MS } from './index';
import { PluginResultType } from '../../types';
import { timerStore } from './timerStore';

// Mock logger
vi.mock('../../../../shared/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── parseDurationFlexible ──────────────────────────────────────────────────

describe('parseDurationFlexible', () => {
  describe('short units', () => {
    it('parses "5m"', () => expect(parseDurationFlexible('5m')).toBe(5 * 60_000));
    it('parses "30s"', () => expect(parseDurationFlexible('30s')).toBe(30_000));
    it('parses "2h"', () => expect(parseDurationFlexible('2h')).toBe(2 * 3_600_000));
  });

  describe('long units', () => {
    it('parses "5 minutes"', () => expect(parseDurationFlexible('5 minutes')).toBe(5 * 60_000));
    it('parses "5minutes"', () => expect(parseDurationFlexible('5minutes')).toBe(5 * 60_000));
    it('parses "1 hour"', () => expect(parseDurationFlexible('1 hour')).toBe(3_600_000));
    it('parses "30 seconds"', () => expect(parseDurationFlexible('30 seconds')).toBe(30_000));
    it('parses "10 min"', () => expect(parseDurationFlexible('10 min')).toBe(10 * 60_000));
    it('parses "2 hrs"', () => expect(parseDurationFlexible('2 hrs')).toBe(2 * 3_600_000));
    it('parses "1 sec"', () => expect(parseDurationFlexible('1 sec')).toBe(1000));
  });

  describe('compound durations', () => {
    it('parses "1h30m"', () => expect(parseDurationFlexible('1h30m')).toBe(90 * 60_000));
    it('parses "1h 30m"', () => expect(parseDurationFlexible('1h 30m')).toBe(90 * 60_000));
    it('parses "5m30s"', () => expect(parseDurationFlexible('5m30s')).toBe(5 * 60_000 + 30_000));
    it('parses "1h 30m 10s"', () =>
      expect(parseDurationFlexible('1h 30m 10s')).toBe(3_600_000 + 30 * 60_000 + 10_000));
  });

  describe('colon format', () => {
    it('parses "1:30" as 1m30s', () => expect(parseDurationFlexible('1:30')).toBe(90_000));
    it('parses "5:00" as 5m', () => expect(parseDurationFlexible('5:00')).toBe(5 * 60_000));
    it('parses "1:30:00" as 1h30m', () =>
      expect(parseDurationFlexible('1:30:00')).toBe(90 * 60_000));
  });

  describe('bare number (minutes)', () => {
    it('parses "5" as 5 minutes', () => expect(parseDurationFlexible('5')).toBe(5 * 60_000));
    it('parses "90" as 90 minutes', () => expect(parseDurationFlexible('90')).toBe(90 * 60_000));
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => expect(parseDurationFlexible('')).toBeNull());
    it('returns null for garbage', () => expect(parseDurationFlexible('abc')).toBeNull());
    it('returns null for 0', () => expect(parseDurationFlexible('0')).toBeNull());
    it('treats "-5m" as 5m (ignores leading dash)', () =>
      expect(parseDurationFlexible('-5m')).toBe(5 * 60_000));
  });

  describe('max duration cap (24h)', () => {
    it('returns null for 25h', () => expect(parseDurationFlexible('25h')).toBeNull());
    it('allows exactly 24h', () => expect(parseDurationFlexible('24h')).toBe(MAX_DURATION_MS));
    it('returns null for 1500m (25h)', () => expect(parseDurationFlexible('1500m')).toBeNull());
  });

  describe('case insensitivity', () => {
    it('parses "5M"', () => expect(parseDurationFlexible('5M')).toBe(5 * 60_000));
    it('parses "2H"', () => expect(parseDurationFlexible('2H')).toBe(2 * 3_600_000));
  });
});

// ── TimerPlugin ────────────────────────────────────────────────────────────

describe('TimerPlugin', () => {
  let plugin: TimerPlugin;

  beforeEach(() => {
    plugin = new TimerPlugin();
    // Cancel all active timers to keep tests isolated
    for (const timer of timerStore.getActiveTimers()) {
      timerStore.cancelTimer(timer.id);
    }
  });

  afterEach(() => {
    for (const timer of timerStore.getActiveTimers()) {
      timerStore.cancelTimer(timer.id);
    }
  });

  // ── canHandle ──────────────────────────────────────────────────────────

  describe('canHandle', () => {
    it('accepts "timer 5m"', () => {
      expect(plugin.canHandle({ query: 'timer 5m' })).toBe(true);
    });

    it('accepts bare "timer"', () => {
      expect(plugin.canHandle({ query: 'timer' })).toBe(true);
    });

    it('accepts "countdown 30s"', () => {
      expect(plugin.canHandle({ query: 'countdown 30s' })).toBe(true);
    });

    it('accepts "pomodoro"', () => {
      expect(plugin.canHandle({ query: 'pomodoro' })).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(plugin.canHandle({ query: 'TIMER 10m' })).toBe(true);
    });

    it('rejects unrelated queries', () => {
      expect(plugin.canHandle({ query: 'alarm 5m' })).toBe(false);
      expect(plugin.canHandle({ query: '' })).toBe(false);
    });
  });

  // ── match: flexible parsing ────────────────────────────────────────────

  describe('match — flexible duration parsing', () => {
    it('parses "timer 5m"', async () => {
      const results = await plugin.match({ query: 'timer 5m' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const startResult = results.find((r) => (r.data as Record<string, unknown>).action === 'start');
      expect(startResult).toBeDefined();
      expect((startResult!.data as Record<string, unknown>).duration).toBe(5 * 60_000);
    });

    it('parses "timer 5 minutes"', async () => {
      const results = await plugin.match({ query: 'timer 5 minutes' });
      const startResult = results.find((r) => (r.data as Record<string, unknown>).action === 'start');
      expect(startResult).toBeDefined();
      expect((startResult!.data as Record<string, unknown>).duration).toBe(5 * 60_000);
    });

    it('parses "timer 1h30m work session"', async () => {
      const results = await plugin.match({ query: 'timer 1h30m work session' });
      const startResult = results.find((r) => (r.data as Record<string, unknown>).action === 'start');
      expect(startResult).toBeDefined();
      expect((startResult!.data as Record<string, unknown>).duration).toBe(90 * 60_000);
      expect((startResult!.data as Record<string, unknown>).label).toBe('work session');
    });

    it('parses "countdown 30s"', async () => {
      const results = await plugin.match({ query: 'countdown 30s' });
      const startResult = results.find((r) => (r.data as Record<string, unknown>).action === 'start');
      expect(startResult).toBeDefined();
      expect((startResult!.data as Record<string, unknown>).duration).toBe(30_000);
    });

    it('parses bare number "timer 10" as 10 minutes', async () => {
      const results = await plugin.match({ query: 'timer 10' });
      const startResult = results.find((r) => (r.data as Record<string, unknown>).action === 'start');
      expect(startResult).toBeDefined();
      expect((startResult!.data as Record<string, unknown>).duration).toBe(10 * 60_000);
    });
  });

  // ── match: presets ─────────────────────────────────────────────────────

  describe('match — presets', () => {
    it('shows quick presets for bare "timer"', async () => {
      const results = await plugin.match({ query: 'timer' });
      expect(results.length).toBeGreaterThanOrEqual(4);
      expect(results.some((r) => r.title.includes('1 Minute'))).toBe(true);
      expect(results.some((r) => r.title.includes('Pomodoro'))).toBe(true);
    });

    it('shows pomodoro presets', async () => {
      const results = await plugin.match({ query: 'pomodoro' });
      expect(results.length).toBe(4);
      expect(results[0].data?.action).toBe('open-view');
      expect(results[1].title).toContain('25 minutes');
    });
  });

  // ── match: active timer results ────────────────────────────────────────

  describe('match — active timers shown in results', () => {
    it('shows active timers with cancel action when typing "timer"', async () => {
      timerStore.startTimer(60_000, 'Test Timer');

      const results = await plugin.match({ query: 'timer' });
      const cancelResult = results.find(
        (r) => (r.data as Record<string, unknown>).action === 'cancel',
      );
      expect(cancelResult).toBeDefined();
      expect(cancelResult!.title).toContain('Test Timer');
      expect(cancelResult!.subtitle).toContain('cancel');
    });
  });

  // ── execute ────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('starts a timer via timerStore', async () => {
      const before = timerStore.getActiveTimers().length;
      await plugin.execute({
        id: 'timer-test',
        type: PluginResultType.Timer,
        title: 'Test',
        score: 100,
        pluginId: 'timer',
        data: { action: 'start', duration: 60_000, label: 'Test' },
      });
      expect(timerStore.getActiveTimers().length).toBe(before + 1);
    });

    it('cancels a timer', async () => {
      const id = timerStore.startTimer(60_000, 'To Cancel');
      expect(timerStore.getTimer(id)).toBeDefined();

      await plugin.execute({
        id: 'timer-cancel',
        type: PluginResultType.Timer,
        title: 'Cancel',
        score: 100,
        pluginId: 'timer',
        data: { action: 'cancel', timerId: id },
      });
      expect(timerStore.getTimer(id)).toBeUndefined();
    });
  });
});

// ── timerStore persistence ─────────────────────────────────────────────────

describe('timerStore persistence', () => {
  afterEach(() => {
    for (const timer of timerStore.getActiveTimers()) {
      timerStore.cancelTimer(timer.id);
    }
    localStorage.removeItem('volt-timers');
  });

  it('persists timers to localStorage on start', () => {
    timerStore.startTimer(60_000, 'Persist Test');
    const stored = localStorage.getItem('volt-timers');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed.some((t: { label: string }) => t.label === 'Persist Test')).toBe(true);
  });

  it('removes timer from localStorage on cancel', () => {
    const id = timerStore.startTimer(60_000, 'Cancel Persist');
    timerStore.cancelTimer(id);
    const stored = localStorage.getItem('volt-timers');
    const parsed = JSON.parse(stored!);
    expect(parsed.some((t: { id: string }) => t.id === id)).toBe(false);
  });
});
