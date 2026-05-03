/**
 * Timer display component
 * Apple-inspired inline bar showing active timers with circular progress and controls
 */

import React from 'react';
import { Pause, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTimers } from './useTimers';
import { timerStore } from './timerStore';

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
    <div
      className="flex flex-col gap-1.5 px-3 py-2 border-t border-hairline"
      role="region"
      aria-label="Active timers"
    >
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
            className="relative flex items-center gap-3 px-3 py-2 rounded-xl bg-surface border border-hairline transition-colors"
            data-timer-mode={mode}
            style={{ ['--timer-color' as string]: meta.color }}
          >
            {/* Clickable wrapper for ring+info+time */}
            <button
              type="button"
              className="flex items-center gap-3 flex-1 min-w-0 p-0 border-0 bg-transparent text-inherit cursor-pointer text-left rounded-lg disabled:cursor-default"
              onClick={onOpenView}
              disabled={!onOpenView}
              title={onOpenView ? 'Open focus timer' : undefined}
            >
              {/* Circular progress ring */}
              <div
                className="relative shrink-0 w-10 h-10 grid place-items-center"
                aria-hidden="true"
              >
                <svg
                  className="absolute inset-0 -rotate-90"
                  width={RING_SIZE}
                  height={RING_SIZE}
                  viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                >
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    strokeWidth={3}
                    stroke="var(--color-border, #242728)"
                  />
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    strokeWidth={3}
                    strokeLinecap="round"
                    stroke={meta.color}
                    strokeDasharray={RING_CIRCUM}
                    strokeDashoffset={dashOffset}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <span className="relative text-sm leading-none" style={{ filter: 'saturate(1.1)' }}>
                  {meta.emoji}
                </span>
              </div>

              {/* Info column */}
              <div className="flex flex-col gap-px min-w-0 flex-1">
                <span
                  className="text-[13px] font-medium text-ink tracking-[-0.1px] whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                  title={timer.label}
                >
                  {timer.label}
                </span>
                <span className="text-[10.5px] font-medium text-mute tracking-[0.4px] uppercase leading-tight">
                  {timer.isPaused ? 'Paused' : meta.label}
                </span>
              </div>

              {/* Time */}
              <span
                className={cn(
                  'font-mono text-lg tabular-nums font-light tracking-[-0.8px] min-w-[62px] text-right leading-none',
                  timer.isPaused ? 'text-mute' : 'text-ink',
                  lowTime && 'animate-pulse'
                )}
                style={lowTime ? { color: meta.color } : undefined}
                aria-live="polite"
              >
                {formatDuration(remaining)}
              </span>
            </button>

            {/* Controls */}
            <div className="flex items-center gap-1.5">
              {timer.isPaused ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-[26px] h-[26px] p-0 rounded-full border border-hairline bg-surface-elevated text-mute cursor-pointer transition-colors hover:text-on-dark active:scale-95"
                  style={{ background: meta.color, color: '#fff', borderColor: 'transparent' }}
                  onClick={() => resumeTimer(timer.id)}
                  title="Resume"
                  aria-label="Resume timer"
                >
                  <Play size={12} strokeWidth={2.5} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-[26px] h-[26px] p-0 rounded-full border border-hairline bg-surface-elevated text-mute cursor-pointer transition-colors hover:text-on-dark active:scale-95"
                  onClick={() => pauseTimer(timer.id)}
                  title="Pause"
                  aria-label="Pause timer"
                >
                  <Pause size={12} strokeWidth={2.5} fill="currentColor" />
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center justify-center w-[26px] h-[26px] p-0 rounded-full border border-hairline bg-surface-elevated text-mute cursor-pointer transition-colors hover:text-on-dark hover:bg-accent-red-soft active:scale-95"
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
