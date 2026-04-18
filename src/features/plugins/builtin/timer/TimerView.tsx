/**
 * Focus Timer — dedicated Pomodoro view.
 * Two-column layout: timer ring + controls on the left, tasks on the right.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import { parseDurationFlexible, MAX_DURATION_MS } from './index';
import { timerStore } from './timerStore';
import { tasksStore, type PomodoroTask } from './tasksStore';
import './TimerView.css';

// ── Modes ────────────────────────────────────────────────────────────────

type Mode = 'focus' | 'short' | 'long' | 'custom';

interface ModeCfg {
  key: Mode;
  label: string;
  short: string;
  minutes: number;
  color: string;
  emoji: string;
}

const DEFAULT_CUSTOM_MINUTES = 10;

const MODES: Record<Mode, ModeCfg> = {
  focus: { key: 'focus', label: 'Focus', short: 'Focus', minutes: 25, color: '#FF3B30', emoji: '🍅' },
  short: {
    key: 'short',
    label: 'Short break',
    short: 'Short break',
    minutes: 5,
    color: '#34C759',
    emoji: '☕',
  },
  long: {
    key: 'long',
    label: 'Long break',
    short: 'Long break',
    minutes: 15,
    color: '#007AFF',
    emoji: '🌴',
  },
  custom: {
    key: 'custom',
    label: 'Custom',
    short: 'Custom',
    minutes: DEFAULT_CUSTOM_MINUTES,
    color: '#FF9500',
    emoji: '⏱️',
  },
};

const MAX_SESSIONS = 4;
const SESSION_KEY = 'volt-pomodoro-session';

const TIMER_LABELS: Record<Mode, string> = {
  focus: 'Focus',
  short: 'Short Break',
  long: 'Long Break',
  custom: 'Custom Timer',
};

interface SessionState {
  mode: Mode;
  sessionsDone: number;
  activeTimerId: string | null;
  /** Duration in ms for the Custom mode — persisted between sessions */
  customMs: number;
}

function loadSession(): SessionState {
  const defaults: SessionState = {
    mode: 'focus',
    sessionsDone: 0,
    activeTimerId: null,
    customMs: DEFAULT_CUSTOM_MINUTES * 60_000,
  };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      return {
        mode: (parsed.mode as Mode) ?? defaults.mode,
        sessionsDone: parsed.sessionsDone ?? defaults.sessionsDone,
        activeTimerId: parsed.activeTimerId ?? defaults.activeTimerId,
        customMs:
          typeof parsed.customMs === 'number' && parsed.customMs > 0
            ? parsed.customMs
            : defaults.customMs,
      };
    }
  } catch {
    // ignore
  }
  return defaults;
}

function saveSession(s: SessionState): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

// ── Ring geometry ────────────────────────────────────────────────────────

const RING_SIZE = 240;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────────────────

interface TimerViewProps {
  onClose: () => void;
}

export const TimerView: React.FC<TimerViewProps> = ({ onClose }) => {
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [tasks, setTasks] = useState<PomodoroTask[]>(() => tasksStore.getTasks());
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const addInputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const currentMode = MODES[session.mode];
  const totalMs =
    session.mode === 'custom' ? session.customMs : currentMode.minutes * 60 * 1000;

  // Resolve the active timer (if our stored id still exists in store)
  const activeTimer = session.activeTimerId ? timerStore.getTimer(session.activeTimerId) : undefined;
  const remaining = activeTimer
    ? timerStore.getRemainingTime(activeTimer.id)
    : totalMs;
  const running = !!activeTimer && !activeTimer.isPaused;
  const paused = !!activeTimer && activeTimer.isPaused;
  const pct = totalMs > 0 ? Math.min(1, Math.max(0, remaining / totalMs)) : 0;
  const dashOffset = RING_CIRCUM * (1 - pct);

  // Persist session changes
  useEffect(() => {
    saveSession(session);
  }, [session]);

  // Subscribe to timer events (ticks, completions, cancellations)
  useEffect(() => {
    const unsubscribe = timerStore.subscribe((event) => {
      if (event.timer.id !== session.activeTimerId) return;

      if (event.type === 'tick') {
        setTick((t) => t + 1);
        return;
      }

      if (event.type === 'complete') {
        // Advance session / auto-cycle — Custom stays on itself
        setSession((prev) => {
          if (prev.mode === 'custom') {
            return { ...prev, activeTimerId: null };
          }
          if (prev.mode === 'focus') {
            const nextDone = Math.min(prev.sessionsDone + 1, MAX_SESSIONS);
            const shouldLong = nextDone >= MAX_SESSIONS;
            return {
              ...prev,
              mode: shouldLong ? 'long' : 'short',
              sessionsDone: shouldLong ? 0 : nextDone,
              activeTimerId: null,
            };
          }
          return { ...prev, mode: 'focus', activeTimerId: null };
        });
        return;
      }

      if (event.type === 'cancel') {
        setSession((prev) => ({ ...prev, activeTimerId: null }));
      }
    });
    return unsubscribe;
  }, [session.activeTimerId]);

  // Tasks subscription
  useEffect(() => {
    const unsubscribe = tasksStore.subscribe((next) => setTasks([...next]));
    return unsubscribe;
  }, []);

  // Focus input when opening add field
  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  // Keyboard: Escape closes, Space toggles play/pause when not in input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape' && !isInput) {
        e.preventDefault();
        onClose();
      }
      if (e.key === ' ' && !isInput) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, session.activeTimerId, session.mode]);

  // ── Actions ────────────────────────────────────────────────────────────

  const switchMode = useCallback(
    (mode: Mode) => {
      if (session.activeTimerId) timerStore.cancelTimer(session.activeTimerId);
      setSession((prev) => ({ ...prev, mode, activeTimerId: null }));
    },
    [session.activeTimerId]
  );

  const togglePlay = useCallback(() => {
    if (running && session.activeTimerId) {
      timerStore.pauseTimer(session.activeTimerId);
      setTick((t) => t + 1);
      return;
    }
    if (paused && session.activeTimerId) {
      timerStore.resumeTimer(session.activeTimerId);
      setTick((t) => t + 1);
      return;
    }
    // Fresh start
    const id = timerStore.startTimer(totalMs, TIMER_LABELS[session.mode]);
    setSession((prev) => ({ ...prev, activeTimerId: id }));
  }, [running, paused, session.activeTimerId, session.mode, totalMs]);

  const resetCurrent = useCallback(() => {
    if (session.activeTimerId) timerStore.cancelTimer(session.activeTimerId);
    setSession((prev) => ({ ...prev, activeTimerId: null }));
  }, [session.activeTimerId]);

  const skipToNext = useCallback(() => {
    if (session.activeTimerId) timerStore.cancelTimer(session.activeTimerId);
    setSession((prev) => {
      if (prev.mode === 'custom') {
        return { ...prev, activeTimerId: null };
      }
      if (prev.mode === 'focus') {
        const nextDone = Math.min(prev.sessionsDone + 1, MAX_SESSIONS);
        const shouldLong = nextDone >= MAX_SESSIONS;
        return {
          ...prev,
          mode: shouldLong ? 'long' : 'short',
          sessionsDone: shouldLong ? 0 : nextDone,
          activeTimerId: null,
        };
      }
      return { ...prev, mode: 'focus', activeTimerId: null };
    });
  }, [session.activeTimerId]);

  // ── Custom duration handling ─────────────────────────────────────────

  const commitCustomDuration = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) {
      setCustomError(null);
      return;
    }
    const ms = parseDurationFlexible(trimmed);
    if (ms === null) {
      setCustomError("Try “25m”, “1h 30m”, “90”, or “1:30”");
      return;
    }
    if (ms < 1000 || ms > MAX_DURATION_MS) {
      setCustomError('Duration must be between 1s and 24h');
      return;
    }
    setCustomError(null);
    setCustomInput('');
    // Cancel any running timer of the previous custom duration
    if (session.activeTimerId) timerStore.cancelTimer(session.activeTimerId);
    setSession((prev) => ({ ...prev, customMs: ms, activeTimerId: null }));
  }, [customInput, session.activeTimerId]);

  // Focus the custom input when entering Custom mode with no active timer
  useEffect(() => {
    if (session.mode === 'custom' && !activeTimer) {
      const t = window.setTimeout(() => customInputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [session.mode, activeTimer]);

  const submitTask = useCallback(() => {
    if (!newLabel.trim()) {
      setAdding(false);
      return;
    }
    tasksStore.add(newLabel);
    setNewLabel('');
    setAdding(false);
  }, [newLabel]);

  const remainingTasks = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="timer-view" style={{ ['--mode-color' as string]: currentMode.color }}>
      {/* Header */}
      <header className="tv-header">
        <button
          type="button"
          className="tv-back"
          onClick={onClose}
          aria-label="Back to search"
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <div className="tv-header-title">
          <span className="tv-header-emoji" aria-hidden="true">
            {currentMode.emoji}
          </span>
          <span className="tv-header-name">Focus Timer</span>
        </div>
        {session.mode !== 'custom' ? (
          <div className="tv-session-pill" title="Pomodoro sessions completed">
            Session{' '}
            {Math.min(
              session.sessionsDone + (session.mode === 'focus' ? 1 : 0),
              MAX_SESSIONS
            )}{' '}
            / {MAX_SESSIONS}
          </div>
        ) : (
          <div className="tv-session-pill" title="Custom duration">
            {fmt(session.customMs)}
          </div>
        )}
      </header>

      <div className="tv-body">
        {/* LEFT — timer column */}
        <section className="tv-timer-col" aria-label="Pomodoro timer">
          <div className="tv-tabs" role="tablist" aria-label="Timer mode">
            {(Object.values(MODES) as ModeCfg[]).map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={session.mode === m.key}
                className={`tv-tab${session.mode === m.key ? ' is-active' : ''}`}
                onClick={() => switchMode(m.key)}
                style={session.mode === m.key ? { color: m.color } : undefined}
              >
                {m.short}
              </button>
            ))}
          </div>

          {session.mode === 'custom' && !activeTimer && (
            <div className="tv-custom-row">
              <input
                ref={customInputRef}
                type="text"
                className={`tv-custom-input${customError ? ' is-invalid' : ''}`}
                placeholder="e.g. 10m, 1h30m, 90, 1:30"
                value={customInput}
                onChange={(e) => {
                  setCustomInput(e.target.value);
                  if (customError) setCustomError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCustomDuration();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setCustomInput('');
                    setCustomError(null);
                  }
                }}
                aria-label="Custom timer duration"
                aria-invalid={!!customError}
                aria-describedby={customError ? 'tv-custom-error' : undefined}
                spellCheck={false}
              />
              <button
                type="button"
                className="tv-custom-set"
                onClick={commitCustomDuration}
                disabled={!customInput.trim()}
              >
                Set
              </button>
            </div>
          )}
          {session.mode === 'custom' && customError && (
            <div id="tv-custom-error" className="tv-custom-error" role="alert">
              {customError}
            </div>
          )}

          <div className="tv-ring-wrap">
            <svg
              className="tv-ring"
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              aria-hidden="true"
            >
              <circle
                className="tv-ring-track"
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
              />
              <circle
                className={`tv-ring-progress${paused ? ' is-paused' : ''}`}
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                strokeDasharray={RING_CIRCUM}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="tv-ring-center">
              <span className="tv-time" aria-live="polite">
                {fmt(remaining)}
              </span>
              <span className="tv-time-label">
                {paused ? 'Paused' : currentMode.label}
              </span>
            </div>
          </div>

          {session.mode !== 'custom' ? (
            <div
              className="tv-dots"
              aria-label={`${session.sessionsDone} of ${MAX_SESSIONS} sessions completed`}
            >
              {Array.from({ length: MAX_SESSIONS }).map((_, i) => (
                <span
                  key={i}
                  className={`tv-dot${i < session.sessionsDone ? ' is-filled' : ''}`}
                />
              ))}
            </div>
          ) : (
            <div className="tv-dots tv-dots-placeholder" aria-hidden="true" />
          )}

          <div className="tv-controls">
            <button
              type="button"
              className="tv-ctrl"
              onClick={resetCurrent}
              title="Reset current timer"
              aria-label="Reset"
            >
              <RotateCcw size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="tv-play"
              onClick={togglePlay}
              aria-label={running ? 'Pause' : 'Start'}
            >
              {running ? (
                <Pause size={22} strokeWidth={0} fill="currentColor" />
              ) : (
                <Play size={22} strokeWidth={0} fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              className="tv-ctrl"
              onClick={skipToNext}
              title="Skip to next phase"
              aria-label="Skip"
            >
              <SkipForward size={15} strokeWidth={2} fill="currentColor" />
            </button>
          </div>
        </section>

        {/* RIGHT — tasks column */}
        <section className="tv-tasks-col" aria-label="Task list">
          <div className="tv-tasks-header">
            <div className="tv-tasks-title">
              <span className="tv-tasks-eyebrow">Tasks</span>
              {tasks.length > 0 && (
                <span className="tv-tasks-count">{remainingTasks} open</span>
              )}
            </div>
            <button
              type="button"
              className="tv-add-btn"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
            >
              <Plus size={13} strokeWidth={2.2} />
              <span>Add</span>
            </button>
          </div>

          {adding && (
            <div className="tv-task-input-row">
              <input
                ref={addInputRef}
                className="tv-task-input"
                type="text"
                placeholder="What are you working on?"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitTask();
                  if (e.key === 'Escape') {
                    setAdding(false);
                    setNewLabel('');
                  }
                }}
              />
              <button type="button" className="tv-task-save" onClick={submitTask}>
                Add
              </button>
            </div>
          )}

          {tasks.length === 0 && !adding ? (
            <div className="tv-tasks-empty">
              <div className="tv-tasks-empty-title">No tasks yet</div>
              <div className="tv-tasks-empty-hint">
                Add what you'll focus on during this session.
              </div>
            </div>
          ) : (
            <ul className="tv-task-list">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={`tv-task${task.done ? ' is-done' : ''}`}
                >
                  <button
                    type="button"
                    className="tv-task-check"
                    onClick={() => tasksStore.toggle(task.id)}
                    aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
                  >
                    {task.done && <Check size={10} strokeWidth={3} />}
                  </button>
                  <span className="tv-task-label">{task.label}</span>
                  <button
                    type="button"
                    className="tv-task-remove"
                    onClick={() => tasksStore.remove(task.id)}
                    aria-label="Delete task"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tasks.some((t) => t.done) && (
            <button
              type="button"
              className="tv-clear-done"
              onClick={() => tasksStore.clearCompleted()}
            >
              <Trash2 size={11} strokeWidth={2} />
              Clear completed
            </button>
          )}
        </section>
      </div>
    </div>
  );
};

export default TimerView;
