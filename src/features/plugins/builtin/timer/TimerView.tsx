import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  Timer,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { timerStore } from './timerStore';
import { tasksStore, type PomodoroTask } from './tasksStore';
import { focusSession, advanceFocusSession, type TimerMode } from './timerSession';
import { parseDurationFlexible } from './index';
import { useAppStore } from '../../../../stores/appStore';
import { resolveTimerDurations } from '../../../settings/behavior/pluginOptions';
import './timer.css';

const MODES: TimerMode[] = ['focus', 'short', 'long', 'custom'];
const ICONS = { focus: Focus, short: Coffee, long: MoonStar, custom: Timer };
// Keep stable labels for the global timer widget's mode detection.
const LABELS = { focus: 'Focus', short: 'Short Break', long: 'Long Break', custom: 'Custom Timer' };
const CIRCUMFERENCE = 2 * Math.PI * 91;
function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  return hours > 0
    ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function TimerView({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation('timer');
  const session = useSyncExternalStore(focusSession.subscribe, focusSession.getSnapshot);
  const [tasks, setTasks] = useState<PomodoroTask[]>(() => [...tasksStore.getTasks()]);
  const [taskInput, setTaskInput] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState(false);
  const [pendingMode, setPendingMode] = useState<TimerMode | null>(null);
  const [, tick] = useState(0);
  const customRef = useRef<HTMLInputElement>(null);
  const durations = resolveTimerDurations(useAppStore((s) => s.settings?.plugins));
  const lengths = {
    focus: durations.workMinutes * 60_000,
    short: durations.shortBreakMinutes * 60_000,
    long: durations.longBreakMinutes * 60_000,
    custom: session.customMs,
  };
  const active = session.activeTimerId ? timerStore.getTimer(session.activeTimerId) : undefined;
  const running = !!active && !active.isPaused;
  const total = active?.duration ?? lengths[session.mode];
  const remaining = active ? timerStore.getRemainingTime(active.id) : total;
  const ModeIcon = ICONS[session.mode];
  const openTasks = tasks.filter((task) => !task.done);
  const doneTasks = tasks.filter((task) => task.done);
  const nextMode =
    session.mode === 'focus' ? (session.sessionsDone >= 3 ? 'long' : 'short') : 'focus';
  const stateLabel = running ? t('view.running') : active ? t('view.paused') : t('view.ready');

  useEffect(
    () =>
      timerStore.subscribe((event) => {
        if (
          event.timer.id === focusSession.getSnapshot().activeTimerId ||
          event.type === 'complete' ||
          event.type === 'cancel'
        )
          tick((n) => n + 1);
      }),
    []
  );
  useEffect(() => tasksStore.subscribe((next) => setTasks([...next])), []);
  const hasActiveTimer = !!active;
  useEffect(() => {
    if (session.mode === 'custom' && !hasActiveTimer) customRef.current?.focus();
  }, [session.mode, hasActiveTimer]);

  const applyCustom = useCallback((): number | null => {
    if (!customInput.trim()) return session.customMs;
    const duration = parseDurationFlexible(customInput);
    if (duration === null) {
      setCustomError(true);
      customRef.current?.focus();
      return null;
    }
    focusSession.update({ ...focusSession.getSnapshot(), customMs: duration });
    setCustomInput('');
    setCustomError(false);
    return duration;
  }, [customInput, session.customMs]);
  const toggle = useCallback(() => {
    if (active) {
      if (active.isPaused) timerStore.resumeTimer(active.id);
      else timerStore.pauseTimer(active.id);
      return;
    }
    const duration = session.mode === 'custom' ? applyCustom() : total;
    if (duration === null) return;
    const id = timerStore.startTimer(duration, LABELS[session.mode]);
    focusSession.update({ ...focusSession.getSnapshot(), activeTimerId: id });
  }, [active, session.mode, total, applyCustom]);
  const changeMode = (mode: TimerMode) => {
    if (mode === session.mode) return;
    if (active) {
      setPendingMode(mode);
      return;
    }
    focusSession.update({ ...session, mode });
    setCustomError(false);
    setCustomInput('');
  };
  const reset = () => {
    if (session.activeTimerId) timerStore.cancelTimer(session.activeTimerId);
    setPendingMode(null);
  };
  const skip = () => {
    const next = advanceFocusSession(session, false);
    if (session.activeTimerId) timerStore.cancelTimer(session.activeTimerId);
    focusSession.update(next);
    setPendingMode(null);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (pendingMode) setPendingMode(null);
        else onClose();
      }
      if (
        (event.code === 'Space' || event.key === ' ') &&
        !target?.closest('button,a,[role="checkbox"]')
      ) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, onClose, pendingMode]);

  return (
    <div className="focus-timer" data-mode={session.mode}>
      <header className="ft-header">
        <button
          className="ft-icon-button"
          onClick={onClose}
          aria-label={t('view.back')}
          title={t('view.back')}
        >
          <ArrowLeft size={17} />
        </button>
        <span className="ft-header-icon">
          <Timer size={17} />
        </span>
        <h1>{t('view.title')}</h1>
        <span className="ft-header-status">
          <span className={running ? 'ft-status-dot is-running' : 'ft-status-dot'} />
          {stateLabel}
        </span>
      </header>
      <div className="ft-body">
        <section className="ft-clock-panel" data-mode={session.mode} aria-label={t('view.title')}>
          <div className="ft-modes" role="group" aria-label={t('view.modes')}>
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={mode === session.mode}
                onClick={() => changeMode(mode)}
              >
                {t(`view.mode.${mode}`)}
              </button>
            ))}
          </div>
          {pendingMode && (
            <div className="ft-confirm" role="alert">
              <span>{t('view.replacePrompt')}</span>
              <div>
                <button onClick={() => setPendingMode(null)}>{t('view.keep')}</button>
                <button
                  onClick={() => {
                    const mode = pendingMode;
                    reset();
                    focusSession.update({ ...focusSession.getSnapshot(), mode });
                    setCustomInput('');
                    setCustomError(false);
                  }}
                >
                  {t('view.switch')}
                </button>
              </div>
            </div>
          )}
          <div
            className="ft-dial"
            role="timer"
            aria-label={t('view.timeRemaining')}
            aria-live="off"
          >
            <svg viewBox="0 0 192 192" aria-hidden="true">
              <circle className="ft-ring-track" cx="96" cy="96" r="91" />
              <circle
                className="ft-ring-progress"
                cx="96"
                cy="96"
                r="91"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, remaining / total)))}
              />
            </svg>
            <div className="ft-dial-content">
              <span className={remaining >= 3_600_000 ? 'ft-time ft-time-hours' : 'ft-time'}>
                {formatTime(remaining)}
              </span>
              <span className="ft-dial-label">
                <ModeIcon size={13} />
                {t(`view.mode.${session.mode}`)}
              </span>
            </div>
          </div>
          <p className="ft-phase-description">{t(`view.description.${session.mode}`)}</p>
          {session.mode === 'custom' && !active && (
            <form
              className="ft-custom"
              onSubmit={(e) => {
                e.preventDefault();
                applyCustom();
              }}
            >
              <label htmlFor="ft-duration">{t('view.duration')}</label>
              <div className="ft-input-row">
                <input
                  id="ft-duration"
                  ref={customRef}
                  value={customInput}
                  onChange={(e) => {
                    setCustomInput(e.target.value);
                    setCustomError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setCustomInput('');
                      setCustomError(false);
                    }
                  }}
                  placeholder={t('view.durationPlaceholder')}
                  aria-invalid={customError}
                  aria-describedby="ft-duration-help"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={!customInput.trim()}>
                  {t('view.apply')}
                </button>
              </div>
              <p
                id="ft-duration-help"
                className={customError ? 'ft-error' : 'ft-hint'}
                role={customError ? 'alert' : undefined}
              >
                {customError ? t('view.durationError') : t('view.durationHelp')}
              </p>
              <div className="ft-presets">
                {[10, 25, 50].map((minutes) => (
                  <button
                    type="button"
                    key={minutes}
                    onClick={() => {
                      focusSession.update({ ...session, customMs: minutes * 60_000 });
                      setCustomInput('');
                      setCustomError(false);
                    }}
                  >
                    {t('view.minutes', { count: minutes })}
                  </button>
                ))}
              </div>
            </form>
          )}
          <div className="ft-controls">
            <button
              className="ft-secondary"
              onClick={reset}
              disabled={!active}
              title={t('view.reset')}
            >
              <RotateCcw size={15} />
              <span>{t('view.reset')}</span>
            </button>
            <button className="ft-primary" onClick={toggle}>
              {running ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              <span>{running ? t('view.pause') : active ? t('view.resume') : t('view.start')}</span>
            </button>
            {session.mode !== 'custom' && (
              <button className="ft-secondary" onClick={skip}>
                <SkipForward size={15} />
                <span>{t('view.skip')}</span>
              </button>
            )}
          </div>
          {session.mode !== 'custom' && (
            <div className="ft-cycle">
              <div className="ft-cycle-line">
                <span>{t('view.completed', { count: session.sessionsDone })}</span>
                <div className="ft-cycle-dots" aria-hidden="true">
                  {[0, 1, 2, 3].map((n) => (
                    <span key={n} className={n < session.sessionsDone ? 'is-done' : ''} />
                  ))}
                </div>
              </div>
              <p>
                {t('view.next', {
                  mode: t(`view.mode.${nextMode}`),
                  minutes: lengths[nextMode] / 60_000,
                })}
              </p>
            </div>
          )}
        </section>
        <section className="ft-tasks" aria-labelledby="ft-tasks-heading">
          <div className="ft-section-heading">
            <h2 id="ft-tasks-heading">{t('view.tasks')}</h2>
            <span>{t('view.openTasks', { count: openTasks.length })}</span>
          </div>
          <p className="ft-section-description">{t('view.tasksDescription')}</p>
          <form
            className="ft-task-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (taskInput.trim()) {
                tasksStore.add(taskInput);
                setTaskInput('');
              }
            }}
          >
            <label className="ft-sr-only" htmlFor="ft-new-task">
              {t('view.newTask')}
            </label>
            <input
              id="ft-new-task"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              maxLength={240}
              placeholder={t('view.taskPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setTaskInput('');
                }
              }}
            />
            <button
              type="submit"
              className="ft-icon-button"
              disabled={!taskInput.trim()}
              aria-label={t('view.addTask')}
            >
              <Plus size={18} />
            </button>
          </form>
          {tasks.length === 0 ? (
            <div className="ft-empty">
              <span className="ft-empty-icon">
                <Focus size={22} strokeWidth={1.5} />
              </span>
              <h3>{t('view.emptyTitle')}</h3>
              <p>{t('view.emptyDescription')}</p>
            </div>
          ) : (
            <ul className="ft-task-list">
              {[...openTasks, ...doneTasks].map((task) => (
                <li key={task.id} className={task.done ? 'ft-task is-done' : 'ft-task'}>
                  <label className="ft-task-label">
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => tasksStore.toggle(task.id)}
                    />
                    <span>{task.label}</span>
                  </label>
                  <button
                    className="ft-icon-button ft-task-delete"
                    onClick={() => tasksStore.remove(task.id)}
                    aria-label={t('view.deleteTask', { task: task.label })}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {doneTasks.length > 0 && (
            <div className="ft-task-summary">
              <span>
                <Check size={13} />
                {t('view.doneTasks', { count: doneTasks.length })}
              </span>
              <button onClick={() => tasksStore.clearCompleted()}>
                {t('view.clearCompleted')}
              </button>
            </div>
          )}
          <div className="ft-task-note">
            <Coffee size={14} />
            <p>{t('view.taskNote')}</p>
          </div>
        </section>
      </div>
      <footer className="ft-footer">
        <span>{t('view.backgroundHint')}</span>
        <span>
          <kbd>Space</kbd> {t('view.shortcutToggle')} <kbd>Esc</kbd> {t('view.shortcutBack')}
        </span>
      </footer>
      <span className="ft-sr-only" role="status" aria-live="polite">
        {t(`view.mode.${session.mode}`)}. {stateLabel}
      </span>
    </div>
  );
}
