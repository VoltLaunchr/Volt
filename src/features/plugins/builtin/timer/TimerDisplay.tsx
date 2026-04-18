/**
 * Timer display component
 * Apple-inspired inline bar showing active timers with circular progress and controls
 */

import React from 'react';
import { Pause, Play, X } from 'lucide-react';
import { useTimers } from './useTimers';
import { timerStore } from './timerStore';
import './TimerDisplay.css';

type TimerMode = 'focus' | 'short' | 'long' | 'custom';

const MODE_META: Record<TimerMode, { color: string; label: string; emoji: string }> = {
  focus: { color: '#FF3B30', label: 'Focus', emoji: '🍅' },
  short: { color: '#34C759', label: 'Short break', emoji: '☕' },
  long: { color: '#007AFF', label: 'Long break', emoji: '🌴' },
  custom: { color: '#FF9500', label: 'Timer', emoji: '⏱️' },
};

function detectMode(label: string): TimerMode {
  const l = label.toLowerCase();
  if (l.includes('long break')) return 'long';
  if (l.includes('short break') || l.includes('break')) return 'short';
  if (l.includes('pomodoro') || l.includes('focus')) return 'focus';
  return 'custom';
}

const RING_SIZE = 40;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

interface TimerDisplayProps {
  /** Called when the user clicks the timer's info area — typically opens the full TimerView. */
  onOpenView?: () => void;
}

export const TimerDisplay: React.FC<TimerDisplayProps> = ({ onOpenView }) => {
  const { activeTimers, cancelTimer, pauseTimer, resumeTimer, formatDuration } = useTimers();

  if (activeTimers.length === 0) return null;

  return (
    <div className="timer-display" role="region" aria-label="Active timers">
      {activeTimers.map((timer) => {
        const remaining = timerStore.getRemainingTime(timer.id);
        const pct =
          timer.duration > 0
            ? Math.min(1, Math.max(0, remaining / timer.duration))
            : 0;
        const dashOffset = RING_CIRCUM * (1 - pct);
        const mode = detectMode(timer.label);
        const meta = MODE_META[mode];
        const lowTime = remaining > 0 && remaining <= 10_000;

        return (
          <div
            key={timer.id}
            className={`timer-item${timer.isPaused ? ' is-paused' : ''}${lowTime ? ' is-low' : ''}`}
            data-timer-mode={mode}
            style={{ ['--timer-color' as string]: meta.color }}
          >
            <button
              type="button"
              className="timer-open-view"
              onClick={onOpenView}
              disabled={!onOpenView}
              title={onOpenView ? 'Open focus timer' : undefined}
            >
              <div className="timer-ring-wrap" aria-hidden="true">
                <svg
                  className="timer-ring"
                  width={RING_SIZE}
                  height={RING_SIZE}
                  viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                >
                  <circle
                    className="timer-ring-track"
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                  />
                  <circle
                    className="timer-ring-progress"
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    strokeDasharray={RING_CIRCUM}
                    strokeDashoffset={dashOffset}
                  />
                </svg>
                <span className="timer-ring-emoji">{meta.emoji}</span>
              </div>

              <div className="timer-info">
                <span className="timer-label" title={timer.label}>
                  {timer.label}
                </span>
                <span className="timer-sublabel">
                  {timer.isPaused ? 'Paused' : meta.label}
                </span>
              </div>

              <span className="timer-time" aria-live="polite">
                {formatDuration(remaining)}
              </span>
            </button>

            <div className="timer-controls">
              {timer.isPaused ? (
                <button
                  type="button"
                  className="timer-btn timer-btn-primary"
                  onClick={() => resumeTimer(timer.id)}
                  title="Resume"
                  aria-label="Resume timer"
                >
                  <Play size={12} strokeWidth={2.5} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="timer-btn"
                  onClick={() => pauseTimer(timer.id)}
                  title="Pause"
                  aria-label="Pause timer"
                >
                  <Pause size={12} strokeWidth={2.5} fill="currentColor" />
                </button>
              )}
              <button
                type="button"
                className="timer-btn timer-btn-cancel"
                onClick={() => cancelTimer(timer.id)}
                title="Cancel"
                aria-label="Cancel timer"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TimerDisplay;
