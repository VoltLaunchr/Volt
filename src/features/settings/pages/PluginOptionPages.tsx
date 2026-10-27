import { useTranslation } from 'react-i18next';
import { Switch } from '@/shared/components/ui/switch';
import {
  MONITOR_REFRESH_OPTIONS_MS,
  TIMER_LONG_BREAK_RANGE,
  TIMER_SHORT_BREAK_RANGE,
  TIMER_WORK_RANGE,
  WINDOW_GAP_RANGE,
} from '../behavior/pluginOptions';
import { SettingsBody, SettingsPageHeader, SettingsSelect } from '../components/SettingsChrome';
import { SettingsNumberField } from '../components/SettingsNumberField';
import {
  SettingsGate,
  SettingsNote,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from '../components/SettingsPrimitives';
import type { PluginSettings } from '../types/settings.types';

interface PluginOptionsProps {
  pluginState: SettingsPluginState;
  plugins: PluginSettings;
  onChange: (patch: Partial<PluginSettings>) => void;
}

/** System Monitor: how often the live metrics refresh. */
export function SystemMonitorPage({ pluginState, plugins, onChange }: PluginOptionsProps) {
  const { t } = useTranslation('settings');
  const current = MONITOR_REFRESH_OPTIONS_MS.includes(plugins.systemMonitorRefreshMs)
    ? MONITOR_REFRESH_OPTIONS_MS
    : [...MONITOR_REFRESH_OPTIONS_MS, plugins.systemMonitorRefreshMs].sort((a, b) => a - b);
  return (
    <div className="settings-page">
      <SettingsPageHeader category="system-monitor" />
      <SettingsBody>
        <SettingsPluginSection page="system-monitor" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="system-monitor.refresh">
            <SettingsRow rowId="system-monitor.refresh.interval">
              <SettingsSelect
                label={t('systemMonitor.refreshInterval')}
                value={plugins.systemMonitorRefreshMs}
                options={current.map((value) => ({
                  value,
                  label: t(`systemMonitor.options.${value}`, {
                    defaultValue: `${value / 1000} s`,
                  }),
                }))}
                onValueChange={(systemMonitorRefreshMs) => onChange({ systemMonitorRefreshMs })}
              />
            </SettingsRow>
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}

/** Timer: Pomodoro work / break lengths. */
export function TimerPage({ pluginState, plugins, onChange }: PluginOptionsProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="settings-page">
      <SettingsPageHeader category="timer" />
      <SettingsBody>
        <SettingsPluginSection page="timer" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="timer.durations" showDescription>
            <SettingsRow rowId="timer.durations.work">
              {({ labelId, descriptionId }) => (
                <SettingsNumberField
                  value={plugins.timerWorkMinutes}
                  range={TIMER_WORK_RANGE}
                  unit={t('timer.minutes')}
                  onCommit={(timerWorkMinutes) => onChange({ timerWorkMinutes })}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                />
              )}
            </SettingsRow>
            <SettingsRow rowId="timer.durations.shortBreak">
              {({ labelId, descriptionId }) => (
                <SettingsNumberField
                  value={plugins.timerShortBreakMinutes}
                  range={TIMER_SHORT_BREAK_RANGE}
                  unit={t('timer.minutes')}
                  onCommit={(timerShortBreakMinutes) => onChange({ timerShortBreakMinutes })}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                />
              )}
            </SettingsRow>
            <SettingsRow rowId="timer.durations.longBreak">
              {({ labelId, descriptionId }) => (
                <SettingsNumberField
                  value={plugins.timerLongBreakMinutes}
                  range={TIMER_LONG_BREAK_RANGE}
                  unit={t('timer.minutes')}
                  onCommit={(timerLongBreakMinutes) => onChange({ timerLongBreakMinutes })}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                />
              )}
            </SettingsRow>
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}

/** Window Management: margin around and between snapped windows. */
export function WindowManagementPage({ pluginState, plugins, onChange }: PluginOptionsProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="settings-page">
      <SettingsPageHeader category="window-management" />
      <SettingsBody>
        <SettingsPluginSection page="window-management" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="window-management.layout">
            <SettingsRow rowId="window-management.layout.gap">
              {({ labelId, descriptionId }) => (
                <SettingsNumberField
                  value={plugins.windowManagementGapPx}
                  range={WINDOW_GAP_RANGE}
                  unit={t('windowManagement.pixels')}
                  onCommit={(windowManagementGapPx) => onChange({ windowManagementGapPx })}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                />
              )}
            </SettingsRow>
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}

/** Quicklinks: which browser opens web links. */
export function QuicklinksPage({
  pluginState,
  plugins,
  onChange,
  browserConfigured,
  onOpenWebSearch,
}: PluginOptionsProps & { browserConfigured: boolean; onOpenWebSearch: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <div className="settings-page">
      <SettingsPageHeader category="quicklinks" />
      <SettingsBody>
        <SettingsPluginSection page="quicklinks" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="quicklinks.browser">
            <SettingsRow rowId="quicklinks.browser.preferred">
              <Switch
                checked={plugins.quicklinksUsePreferredBrowser}
                onCheckedChange={(quicklinksUsePreferredBrowser) =>
                  onChange({ quicklinksUsePreferredBrowser })
                }
              />
            </SettingsRow>
            {plugins.quicklinksUsePreferredBrowser && !browserConfigured && (
              <SettingsNote>
                <button type="button" className="underline" onClick={onOpenWebSearch}>
                  {t('quicklinks.chooseBrowser')}
                </button>
              </SettingsNote>
            )}
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}
