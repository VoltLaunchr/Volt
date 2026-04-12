/**
 * Hook for accessing timer state
 */

import { useCallback, useEffect, useState } from 'react';
import { ActiveTimer, timerStore } from './timerStore';

export interface UseTimersReturn {
  /** List of active timers */
  activeTimers: ActiveTimer[];
  /** Start a new timer */
  startTimer: (duration: number, label: string) => string;
  /** Cancel a timer */
  cancelTimer: (id: string) => void;
  /** Pause a timer */
  pauseTimer: (id: string) => void;
  /** Resume a paused timer */
  resumeTimer: (id: string) => void;
  /** Get remaining time for a timer */
  getRemainingTime: (id: string) => number;
  /** Format duration to string */
  formatDuration: (ms: number) => string;
  /** Whether there are active timers */
  hasActiveTimers: boolean;
}

export function useTimers(): UseTimersReturn {
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>(() =>
    timerStore.getActiveTimers()
  );

  useEffect(() => {
    // Subscribe to timer events
    const unsubscribe = timerStore.subscribe(() => {
      // Update state on any timer event
      setActiveTimers(timerStore.getActiveTimers());
    });

    // Also set up an interval to update remaining times
    const interval = setInterval(() => {
      setActiveTimers([...timerStore.getActiveTimers()]);
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const startTimer = useCallback((duration: number, label: string) => {
    return timerStore.startTimer(duration, label);
  }, []);

  const cancelTimer = useCallback((id: string) => {
    timerStore.cancelTimer(id);
  }, []);

  const pauseTimer = useCallback((id: string) => {
    timerStore.pauseTimer(id);
  }, []);

  const resumeTimer = useCallback((id: string) => {
    timerStore.resumeTimer(id);
  }, []);

  const getRemainingTime = useCallback((id: string) => {
    return timerStore.getRemainingTime(id);
  }, []);

  const formatDuration = useCallback((ms: number) => {
    return timerStore.formatDuration(ms);
  }, []);

  return {
    activeTimers,
    startTimer,
    cancelTimer,
    pauseTimer,
    resumeTimer,
    getRemainingTime,
    formatDuration,
    hasActiveTimers: activeTimers.length > 0,
  };
}
