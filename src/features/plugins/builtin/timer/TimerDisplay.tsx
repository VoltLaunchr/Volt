/**
 * Timer display component
 * Shows active timers with countdown and controls
 */

import React from 'react';
import { useTimers } from './useTimers';
import { timerStore } from './timerStore';
import './TimerDisplay.css';

export const TimerDisplay: React.FC = () => {
  const { activeTimers, cancelTimer, pauseTimer, resumeTimer, formatDuration } = useTimers();

  if (activeTimers.length === 0) {
    return null;
  }

  return (
    <div className="timer-display">
      {activeTimers.map((timer) => {
        const remaining = timerStore.getRemainingTime(timer.id);
        // Guard against division by zero and clamp to 0-100 range
        const progress =
          timer.duration > 0
            ? Math.min(100, Math.max(0, ((timer.duration - remaining) / timer.duration) * 100))
            : 0;

        return (
          <div
            key={timer.id}
            className="timer-item"
            data-timer-type={timer.label.includes('Pomodoro') ? 'pomodoro' : undefined}
          >
            <div className="timer-progress" style={{ width: `${progress}%` }} />
            <div className="timer-content">
              <div className="timer-info">
                <span className="timer-label">
                  {timer.label.includes('Pomodoro') ? '🍅' : '⏱️'} {timer.label}
                </span>
                <span className="timer-time">{formatDuration(remaining)}</span>
              </div>
              <div className="timer-controls">
                {timer.isPaused ? (
                  <button
                    className="timer-btn timer-btn-resume"
                    onClick={() => resumeTimer(timer.id)}
                    title="Resume"
                  >
                    ▶
                  </button>
                ) : (
                  <button
                    className="timer-btn timer-btn-pause"
                    onClick={() => pauseTimer(timer.id)}
                    title="Pause"
                  >
                    ⏸
                  </button>
                )}
                <button
                  className="timer-btn timer-btn-cancel"
                  onClick={() => cancelTimer(timer.id)}
                  title="Cancel"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TimerDisplay;
