import React from 'react';
import { Coffee, Focus, MoonStar, Pause, Play, Timer, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTimers } from './useTimers';
import { timerStore } from './timerStore';
import { focusSession, type TimerMode } from './timerSession';
import './timer.css';

function detectMode(label: string): TimerMode {
  const text = label.toLowerCase();
  if (text.includes('long break')) return 'long';
  if (text.includes('break')) return 'short';
  if (text.includes('pomodoro') || text.includes('focus')) return 'focus';
  return 'custom';
}
const ICONS = { focus: Focus, short: Coffee, long: MoonStar, custom: Timer };
const CIRCUMFERENCE = 2 * Math.PI * 16;
interface TimerDisplayProps {
  onOpenView?: () => void;
}

export function TimerDisplay({ onOpenView }: TimerDisplayProps): React.JSX.Element | null {
  const { t } = useTranslation('timer');
  const { activeTimers, cancelTimer, pauseTimer, resumeTimer, formatDuration } = useTimers();
  if (activeTimers.length === 0) return null;
  return (
    <div className="ft-mini-list" role="region" aria-label={t('view.activeTimers')}>
      {activeTimers.map((timer) => {
        const remaining = timerStore.getRemainingTime(timer.id);
        const mode = detectMode(timer.label);
        const Icon = ICONS[mode];
        const stableLabel = [
          'Focus',
          'Short Break',
          'Long Break',
          'Custom Timer',
          'Pomodoro Work',
        ].includes(timer.label);
        const label = stableLabel ? t(`view.mode.${mode}`) : timer.label;
        return (
          <div className="ft-mini" key={timer.id} data-mode={mode}>
            <button
              type="button"
              className="ft-mini-info"
              disabled={!onOpenView}
              onClick={() => {
                focusSession.update({
                  ...focusSession.getSnapshot(),
                  mode,
                  activeTimerId: timer.id,
                  customMs: timer.duration,
                });
                onOpenView?.();
              }}
              title={t('view.openTimer')}
            >
              <span className="ft-mini-dial" aria-hidden="true">
                <svg viewBox="0 0 36 36">
                  <circle className="ft-ring-track" cx="18" cy="18" r="16" />
                  <circle
                    className="ft-ring-progress"
                    cx="18"
                    cy="18"
                    r="16"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={
                      CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, remaining / timer.duration)))
                    }
                  />
                </svg>
                <Icon size={14} />
              </span>
              <span className="ft-mini-label">
                <strong>{label}</strong>
                <span>{timer.isPaused ? t('view.paused') : t('view.running')}</span>
              </span>
              <span className="ft-mini-time" role="timer" aria-live="off">
                {formatDuration(remaining)}
              </span>
            </button>
            <button
              type="button"
              className="ft-icon-button"
              onClick={() => (timer.isPaused ? resumeTimer(timer.id) : pauseTimer(timer.id))}
              aria-label={`${timer.isPaused ? t('view.resume') : t('view.pause')} — ${label}`}
              title={timer.isPaused ? t('view.resume') : t('view.pause')}
            >
              {timer.isPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              type="button"
              className="ft-icon-button"
              onClick={() => cancelTimer(timer.id)}
              aria-label={`${t('view.cancelTimer')} — ${label}`}
              title={t('view.cancelTimer')}
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
export default TimerDisplay;
