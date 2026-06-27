/**
 * Focus Timer — dedicated Pomodoro view.
 * Two-column layout: timer ring + controls on the left, tasks on the right.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Coffee,
  Focus,
  MoonStar,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  Timer,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseDurationFlexible, MAX_DURATION_MS } from './index';
import { timerStore } from './timerStore';
import { tasksStore, type PomodoroTask } from './tasksStore';

// ── Modes ────────────────────────────────────────────────────────────────

type Mode = 'focus' | 'short' | 'long' | 'custom';

interface ModeCfg {
  key: Mode;
  label: string;
  short: string;
  minutes: number;
  color: string;
  icon: LucideIcon;
}

const DEFAULT_CUSTOM_MINUTES = 10;

const MODES: Record<Mode, ModeCfg> = {
  focus: {
    key: 'focus',
    label: 'Focus',
    short: 'Focus',
    minutes: 25,
    color: '#FF3B30',
    icon: Focus,
  },
  short: {
    key: 'short',
    label: 'Short break',
    short: 'Short break',
    minutes: 5,
    color: '#34C759',
    icon: Coffee,
  },
  long: {
    key: 'long',
    label: 'Long break',
    short: 'Long break',
    minutes: 15,
    color: '#007AFF',
    icon: MoonStar,
  },
  custom: {
    key: 'custom',
    label: 'Custom',
    short: 'Custom',
    minutes: DEFAULT_CUSTOM_MINUTES,
    color: '#FF9500',
    icon: Timer,
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

export function TimerView({ onClose }: TimerViewProps): React.JSX.Element {
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
  const CurrentModeIcon = currentMode.icon;
  const totalMs = session.mode === 'custom' ? session.customMs : currentMode.minutes * 60 * 1000;

  // Resolve the active timer (if our stored id still exists in store)
  const activeTimer = session.activeTimerId
    ? timerStore.getTimer(session.activeTimerId)
    : undefined;
  const remaining = activeTimer ? timerStore.getRemainingTime(activeTimer.id) : totalMs;
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

  // Keyboard: Escape closes, Space toggles play/pause when not in input.
  // Declared after togglePlay so it can be referenced directly in deps.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
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
  }, [onClose, togglePlay]);

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
      setCustomError('Try “25m”, “1h 30m”, “90”, or “1:30”');
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
    <div
      className="w-full h-full flex flex-col bg-canvas text-ink animate-[tv-fade-in_220ms_cubic-bezier(0.4,0,0.2,1)]"
      style={{ ['--mode-color' as string]: currentMode.color }}
    >
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-hairline bg-surface shrink-0">
        <button
          type="button"
          className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-md border border-hairline bg-surface-elevated text-mute cursor-pointer transition-colors hover:text-ink hover:bg-surface"
          onClick={onClose}
          aria-label="Back to search"
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <CurrentModeIcon size={16} aria-hidden="true" style={{ color: currentMode.color }} />
          <span className="text-sm font-semibold tracking-[-0.2px] text-ink">Focus Timer</span>
        </div>
        {session.mode !== 'custom' ? (
          <div
            className="text-[11px] font-medium tracking-[0.2px] px-2.5 py-1 rounded-full text-mute bg-surface-elevated border border-hairline"
            title="Pomodoro sessions completed"
          >
            Session{' '}
            {Math.min(session.sessionsDone + (session.mode === 'focus' ? 1 : 0), MAX_SESSIONS)} /{' '}
            {MAX_SESSIONS}
          </div>
        ) : (
          <div
            className="text-[11px] font-medium tracking-[0.2px] px-2.5 py-1 rounded-full text-mute bg-surface-elevated border border-hairline"
            title="Custom duration"
          >
            {fmt(session.customMs)}
          </div>
        )}
      </header>

      {/* Body: two-column layout */}
      <div className="flex-1 grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
        {/* LEFT — timer column */}
        <section
          className="flex flex-col items-center gap-6 px-6 py-[18px] lg:border-r lg:border-hairline overflow-visible"
          aria-label="Pomodoro timer"
        >
          {/* Mode tabs */}
          <div
            className="inline-flex gap-0.5 p-[3px] rounded-lg bg-surface border border-hairline"
            role="tablist"
            aria-label="Timer mode"
          >
            {Object.values(MODES).map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={session.mode === m.key}
                className={cn(
                  'relative px-3.5 py-[5px] text-xs font-medium tracking-[-0.1px] border-0 bg-transparent text-mute cursor-pointer rounded-[7px] transition-colors hover:text-ink',
                  session.mode === m.key && 'bg-canvas text-ink shadow-sm border border-hairline'
                )}
                onClick={() => switchMode(m.key)}
                style={session.mode === m.key ? { color: m.color } : undefined}
              >
                {m.short}
              </button>
            ))}
          </div>

          {/* Custom duration input */}
          {session.mode === 'custom' && !activeTimer && (
            <div className="flex gap-1.5 w-full max-w-[320px] animate-[tv-fade-in_180ms_ease-out]">
              <input
                ref={customInputRef}
                type="text"
                className={cn(
                  'flex-1 min-w-0 h-8 px-3 text-[13px] tabular-nums rounded-md border bg-surface text-ink outline-none transition-colors',
                  customError ? 'border-accent-red' : 'border-hairline focus:border-hairline-strong'
                )}
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
                className="h-8 px-3.5 text-xs font-semibold tracking-[0.1px] rounded-md border-0 text-white cursor-pointer transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: currentMode.color }}
                onClick={commitCustomDuration}
                disabled={!customInput.trim()}
              >
                Set
              </button>
            </div>
          )}
          {session.mode === 'custom' && customError && (
            <div
              id="tv-custom-error"
              className="text-[11.5px] text-accent-red tracking-[-0.1px] -mt-1.5 animate-[tv-fade-in_160ms_ease-out]"
              role="alert"
            >
              {customError}
            </div>
          )}

          {/* Ring */}
          <div className="relative w-60 h-60 grid place-items-center shrink-0">
            <svg
              className="absolute -inset-2.5 -rotate-90 overflow-visible"
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              aria-hidden="true"
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                strokeWidth={8}
                stroke="rgba(36,39,40,0.8)"
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                strokeWidth={10}
                strokeLinecap="round"
                stroke={currentMode.color}
                strokeDasharray={RING_CIRCUM}
                strokeDashoffset={dashOffset}
                opacity={paused ? 0.55 : 1}
                style={{
                  filter: `drop-shadow(0 0 6px ${currentMode.color}72)`,
                  transition: 'stroke-dashoffset 1s linear',
                }}
              />
            </svg>
            <div className="relative flex flex-col items-center justify-center gap-1">
              <span
                className="font-mono tabular-nums font-extralight leading-none text-ink"
                style={{ fontSize: '58px', letterSpacing: '-3.5px' }}
                aria-live="polite"
              >
                {fmt(remaining)}
              </span>
              <span className="text-[11px] font-medium tracking-[2px] uppercase text-mute">
                {paused ? 'Paused' : currentMode.label}
              </span>
            </div>
          </div>

          {/* Session dots */}
          {session.mode !== 'custom' ? (
            <div
              className="flex gap-2 items-center"
              aria-label={`${session.sessionsDone} of ${MAX_SESSIONS} sessions completed`}
            >
              {Array.from({ length: MAX_SESSIONS }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'w-[7px] h-[7px] rounded-full border border-hairline bg-transparent transition-all',
                    i < session.sessionsDone && 'bg-[var(--mode-color)] border-[var(--mode-color)]'
                  )}
                  style={
                    i < session.sessionsDone
                      ? { boxShadow: `0 0 0 3px ${currentMode.color}26` }
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="h-[10px]" aria-hidden="true" />
          )}

          {/* Controls */}
          <div className="flex items-center gap-[18px] mt-auto pt-1">
            <button
              type="button"
              className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-hairline bg-surface text-mute cursor-pointer transition-colors hover:text-ink hover:bg-surface-elevated active:scale-95"
              onClick={resetCurrent}
              title="Reset current timer"
              aria-label="Reset"
            >
              <RotateCcw size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center w-16 h-16 rounded-full border-0 text-white cursor-pointer pl-[3px] transition-transform active:scale-95"
              style={{
                background: currentMode.color,
                boxShadow: `0 4px 14px ${currentMode.color}72, 0 1px 2px rgba(0,0,0,0.15)`,
              }}
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
              className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-hairline bg-surface text-mute cursor-pointer transition-colors hover:text-ink hover:bg-surface-elevated active:scale-95"
              onClick={skipToNext}
              title="Skip to next phase"
              aria-label="Skip"
            >
              <SkipForward size={15} strokeWidth={2} fill="currentColor" />
            </button>
          </div>
        </section>

        {/* RIGHT — tasks column */}
        <section
          className="flex flex-col gap-2.5 px-5 py-[18px] min-w-0 overflow-hidden"
          aria-label="Task list"
        >
          {/* Tasks header */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[11px] font-semibold tracking-[1.2px] uppercase text-mute">
                Tasks
              </span>
              {tasks.length > 0 && (
                <span className="text-[11px] text-ash tabular-nums">{remainingTasks} open</span>
              )}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-[7px] border border-hairline bg-surface text-mute cursor-pointer transition-colors hover:text-ink hover:bg-surface-elevated"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
            >
              <Plus size={13} strokeWidth={2.2} />
              <span>Add</span>
            </button>
          </div>

          {/* Add task input */}
          {adding && (
            <div className="flex gap-1.5 animate-[tv-fade-in_160ms_ease-out]">
              <input
                ref={addInputRef}
                className="flex-1 min-w-0 h-8 px-2.5 text-[13px] rounded-md border border-hairline bg-canvas text-ink outline-none focus:border-hairline-strong transition-colors"
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
              <button
                type="button"
                className="h-8 px-3 text-xs font-medium rounded-md border-0 text-white cursor-pointer transition-opacity hover:opacity-[0.88]"
                style={{ background: currentMode.color }}
                onClick={submitTask}
              >
                Add
              </button>
            </div>
          )}

          {/* Empty state or task list */}
          {tasks.length === 0 && !adding ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-1 p-5 text-center text-ash border border-dashed border-hairline rounded-lg bg-surface/50">
              <div className="text-[13px] font-medium text-mute">No tasks yet</div>
              <div className="text-[11.5px] leading-[1.4] max-w-[26ch]">
                Add what you'll focus on during this session.
              </div>
            </div>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-[5px] overflow-y-auto flex-1 min-h-0 pr-0.5">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={cn(
                    'flex items-center gap-[9px] px-2.5 py-2 rounded-md bg-surface border border-hairline transition-colors group',
                    'hover:bg-surface-elevated',
                    task.done && 'opacity-80'
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border border-hairline bg-transparent text-transparent cursor-pointer shrink-0 transition-colors',
                      task.done && 'bg-[#34c759] border-[#34c759] text-white'
                    )}
                    onClick={() => tasksStore.toggle(task.id)}
                    aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
                  >
                    {task.done && <Check size={10} strokeWidth={3} />}
                  </button>
                  <span
                    className={cn(
                      'flex-1 text-[13px] text-ink tracking-[-0.1px] whitespace-nowrap overflow-hidden text-ellipsis transition-colors',
                      task.done && 'text-ash line-through decoration-ash'
                    )}
                  >
                    {task.label}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full border-0 bg-transparent text-ash cursor-pointer opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all hover:text-white hover:bg-accent-red-soft"
                    onClick={() => tasksStore.remove(task.id)}
                    aria-label="Delete task"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Clear completed */}
          {tasks.some((t) => t.done) && (
            <button
              type="button"
              className="self-start inline-flex items-center gap-[5px] mt-auto px-2 py-[5px] text-[11px] font-medium rounded-md border-0 bg-transparent text-ash cursor-pointer transition-colors hover:text-accent-red"
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
}

export default TimerView;
