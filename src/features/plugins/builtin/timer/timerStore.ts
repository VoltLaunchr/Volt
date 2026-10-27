/**
 * Timer state management
 * Global store for active timers that persists across window hide/show
 */

import { logger } from '../../../../shared/utils/logger';
import { notifyNative } from '../../../../shared/services/nativeNotificationService';

const STORAGE_KEY = 'volt-timers';
const COMPLETED_KEY = 'volt-completed-timers';
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function isTimer(value: unknown): value is ActiveTimer {
  if (!value || typeof value !== 'object') return false;
  const t = value as ActiveTimer;
  return (
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    typeof t.label === 'string' &&
    Number.isFinite(t.duration) &&
    t.duration >= 1000 &&
    t.duration <= MAX_DURATION_MS &&
    Number.isFinite(t.startTime) &&
    Number.isFinite(t.endTime) &&
    typeof t.isPaused === 'boolean' &&
    (!t.isPaused ||
      (typeof t.remainingWhenPaused === 'number' &&
        Number.isFinite(t.remainingWhenPaused) &&
        t.remainingWhenPaused >= 0 &&
        t.remainingWhenPaused <= t.duration))
  );
}

export interface ActiveTimer {
  id: string;
  label: string;
  duration: number;
  endTime: number;
  startTime: number;
  isPaused: boolean;
  pausedAt?: number;
  remainingWhenPaused?: number;
}

export type TimerEventType = 'start' | 'complete' | 'cancel' | 'pause' | 'resume' | 'tick';

export interface TimerEvent {
  type: TimerEventType;
  timer: ActiveTimer;
}

type TimerListener = (event: TimerEvent) => void;

class TimerStore {
  private timers: Map<string, ActiveTimer> = new Map();
  private timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private listeners: Set<TimerListener> = new Set();
  private completed: ActiveTimer[] = [];

  constructor() {
    this.restoreTimers();
  }

  subscribe(listener: TimerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TimerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  getActiveTimers(): ActiveTimer[] {
    return Array.from(this.timers.values());
  }

  getTimer(id: string): ActiveTimer | undefined {
    return this.timers.get(id);
  }

  /** Bounded completion receipts let the focus cycle reconcile after navigation or restart. */
  getCompletedTimer(id: string): ActiveTimer | undefined {
    return this.completed.find((timer) => timer.id === id);
  }

  private rememberCompletion(timer: ActiveTimer): void {
    this.completed = [...this.completed.filter((t) => t.id !== timer.id), timer].slice(-32);
    try {
      localStorage.setItem(COMPLETED_KEY, JSON.stringify(this.completed));
    } catch {
      // Timer operation remains available when storage is full or unavailable.
    }
  }

  private startTicks(id: string): void {
    if (this.intervals.has(id)) return;
    this.intervals.set(
      id,
      setInterval(() => {
        const timer = this.timers.get(id);
        if (timer && !timer.isPaused) {
          if (timer.endTime <= Date.now()) this.completeTimer(id);
          else this.emit({ type: 'tick', timer });
        }
      }, 1000)
    );
  }

  startTimer(duration: number, label: string): string {
    if (!Number.isFinite(duration) || duration < 1000 || duration > MAX_DURATION_MS) {
      throw new RangeError('Timer duration must be between 1 second and 24 hours');
    }
    const id = `timer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const timer: ActiveTimer = {
      id,
      label,
      duration,
      startTime: now,
      endTime: now + duration,
      isPaused: false,
    };

    this.timers.set(id, timer);

    // Set timeout for completion
    const timeout = setTimeout(() => {
      this.completeTimer(id);
    }, duration);
    this.timeouts.set(id, timeout);

    // Set interval for tick events (every second)
    this.startTicks(id);

    this.emit({ type: 'start', timer });
    this.persist();
    notifyNative({
      title: 'Timer started',
      body: `${label} - ${this.formatDuration(duration)}`,
    }).catch((err) => logger.error('Timer start notification failed:', err));

    return id;
  }

  pauseTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || timer.isPaused) return;
    if (timer.endTime <= Date.now()) {
      this.completeTimer(id);
      return;
    }

    // Clear timeout
    const timeout = this.timeouts.get(id);
    if (timeout) clearTimeout(timeout);

    const now = Date.now();
    timer.isPaused = true;
    timer.pausedAt = now;
    timer.remainingWhenPaused = timer.endTime - now;

    this.emit({ type: 'pause', timer });
    this.persist();
  }

  resumeTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || !timer.isPaused || timer.remainingWhenPaused === undefined) return;
    if (timer.remainingWhenPaused <= 0) {
      this.completeTimer(id);
      return;
    }

    const now = Date.now();
    timer.isPaused = false;
    timer.endTime = now + timer.remainingWhenPaused;
    timer.pausedAt = undefined;

    // Set new timeout
    const timeout = setTimeout(() => {
      this.completeTimer(id);
    }, timer.remainingWhenPaused);
    this.timeouts.set(id, timeout);
    this.startTicks(id);

    timer.remainingWhenPaused = undefined;
    this.emit({ type: 'resume', timer });
    this.persist();
  }

  cancelTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;

    // Clear timeout and interval
    const timeout = this.timeouts.get(id);
    if (timeout) clearTimeout(timeout);
    this.timeouts.delete(id);

    const interval = this.intervals.get(id);
    if (interval) clearInterval(interval);
    this.intervals.delete(id);

    this.timers.delete(id);
    this.emit({ type: 'cancel', timer });
    this.persist();
  }

  private completeTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    const timeout = this.timeouts.get(id);
    if (timeout) clearTimeout(timeout);

    // Clear interval
    const interval = this.intervals.get(id);
    if (interval) clearInterval(interval);
    this.intervals.delete(id);
    this.timeouts.delete(id);

    this.timers.delete(id);
    this.rememberCompletion(timer);
    this.emit({ type: 'complete', timer });
    this.persist();

    notifyNative({ title: 'Timer complete', body: `${timer.label} has finished` }).catch((err) =>
      logger.error('Timer complete notification failed:', err)
    );
    this.playSound();
  }

  getRemainingTime(id: string): number {
    const timer = this.timers.get(id);
    if (!timer) return 0;

    if (timer.isPaused && timer.remainingWhenPaused !== undefined) {
      return timer.remainingWhenPaused;
    }

    return Math.max(0, timer.endTime - Date.now());
  }

  formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private persist(): void {
    try {
      const data = Array.from(this.timers.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage may be unavailable in some environments
    }
  }

  private restoreTimers(): void {
    try {
      const receipts: unknown = JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? '[]');
      this.completed = Array.isArray(receipts) ? receipts.filter(isTimer).slice(-32) : [];
    } catch {
      this.completed = [];
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed: unknown = JSON.parse(raw);
      const saved = Array.isArray(parsed) ? parsed.filter(isTimer) : [];
      const now = Date.now();

      for (const timer of saved) {
        // Skip timers that already expired while the app was closed
        if (!timer.isPaused && timer.endTime <= now) {
          this.rememberCompletion(timer);
          continue;
        }
        if (timer.endTime - now > MAX_DURATION_MS) continue;

        this.timers.set(timer.id, timer);

        if (timer.isPaused) {
          // Paused timers just sit in memory, no timeout needed
          this.emit({ type: 'start', timer });
          continue;
        }

        const remaining = timer.endTime - now;

        // Set timeout for completion
        const timeout = setTimeout(() => {
          this.completeTimer(timer.id);
        }, remaining);
        this.timeouts.set(timer.id, timeout);

        // Set interval for tick events
        this.startTicks(timer.id);

        this.emit({ type: 'start', timer });
      }

      // Clean up storage (remove expired)
      this.persist();
    } catch (err) {
      logger.warn('Failed to restore timers from localStorage', err);
    }
  }

  private playSound(): void {
    try {
      // Chrome caps open AudioContexts at ~6 per page. A fresh context per
      // timer completion silently fails after the limit, so we close it as
      // soon as playback ends.
      const audioContext = new (
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!
      )();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Play 3 beeps
      const playBeep = (time: number) => {
        oscillator.frequency.setValueAtTime(800, time);
        gainNode.gain.setValueAtTime(0.3, time);
        gainNode.gain.setValueAtTime(0, time + 0.15);
      };

      playBeep(audioContext.currentTime);
      playBeep(audioContext.currentTime + 0.25);
      playBeep(audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.75);

      oscillator.addEventListener('ended', () => {
        audioContext.close().catch(() => {});
      });
    } catch (error) {
      logger.error('Failed to play sound:', error);
    }
  }
}

// Singleton instance
export const timerStore = new TimerStore();
