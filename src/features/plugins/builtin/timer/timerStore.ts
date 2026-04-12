/**
 * Timer state management
 * Global store for active timers that persists across window hide/show
 */

import { logger } from '../../../../shared/utils/logger';

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

  startTimer(duration: number, label: string): string {
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
    const interval = setInterval(() => {
      const currentTimer = this.timers.get(id);
      if (currentTimer && !currentTimer.isPaused) {
        this.emit({ type: 'tick', timer: currentTimer });
      }
    }, 1000);
    this.intervals.set(id, interval);

    this.emit({ type: 'start', timer });
    this.showNotification('⏱️ Timer Started', `${label} - ${this.formatDuration(duration)}`).catch(
      (err) => logger.error('Timer start notification failed:', err)
    );

    return id;
  }

  pauseTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || timer.isPaused) return;

    // Clear timeout
    const timeout = this.timeouts.get(id);
    if (timeout) clearTimeout(timeout);

    const now = Date.now();
    timer.isPaused = true;
    timer.pausedAt = now;
    timer.remainingWhenPaused = timer.endTime - now;

    this.emit({ type: 'pause', timer });
  }

  resumeTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || !timer.isPaused || !timer.remainingWhenPaused) return;

    const now = Date.now();
    timer.isPaused = false;
    timer.endTime = now + timer.remainingWhenPaused;
    timer.pausedAt = undefined;

    // Set new timeout
    const timeout = setTimeout(() => {
      this.completeTimer(id);
    }, timer.remainingWhenPaused);
    this.timeouts.set(id, timeout);

    timer.remainingWhenPaused = undefined;
    this.emit({ type: 'resume', timer });
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
  }

  private completeTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;

    // Clear interval
    const interval = this.intervals.get(id);
    if (interval) clearInterval(interval);
    this.intervals.delete(id);
    this.timeouts.delete(id);

    this.timers.delete(id);
    this.emit({ type: 'complete', timer });

    this.showNotification('⏰ Timer Complete!', `${timer.label} has finished`, true).catch(
      (err) => logger.error('Timer complete notification failed:', err)
    );
    this.playSound();
  }

  getRemainingTime(id: string): number {
    const timer = this.timers.get(id);
    if (!timer) return 0;

    if (timer.isPaused && timer.remainingWhenPaused) {
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

  private async showNotification(
    title: string,
    body: string,
    requireInteraction = false
  ): Promise<void> {
    if ('Notification' in window) {
      let permission = Notification.permission;

      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/icon.png',
          requireInteraction,
          tag: 'volt-timer',
        });
      }
    }
  }

  private playSound(): void {
    try {
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
    } catch (error) {
      logger.error('Failed to play sound:', error);
    }
  }
}

// Singleton instance
export const timerStore = new TimerStore();
