import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/components/ui/button';
import { Switch } from '@/shared/components/ui/switch';
import { extractErrorMessage } from '../../../shared/utils/error';
import { webSearchHistory } from '../../web-search';
import { settingsService, type DetectedBrowser } from '../services/settingsService';
import type { WebSearchSettings } from '../types/settings.types';
import { BraveKeySection } from './BraveKeySection';
import { SettingsBody, SettingsPageHeader, SettingsSelect, SettingsStatus } from './SettingsChrome';
import {
  SettingsGate,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from './SettingsPrimitives';

interface WebSearchSettingsPanelProps {
  settings: WebSearchSettings;
  rememberHistory: boolean;
  onSettingsUpdated: (settings: WebSearchSettings) => void;
  onRememberHistoryChange: (enabled: boolean) => void;
  pluginState: SettingsPluginState;
}

export function WebSearchSettingsPanel({
  settings,
  rememberHistory,
  onSettingsUpdated,
  onRememberHistoryChange,
  pluginState,
}: WebSearchSettingsPanelProps) {
  const { t } = useTranslation('settings');
  const [browsers, setBrowsers] = useState<DetectedBrowser[]>([]);
  const [isDetecting, setIsDetecting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyCleared, setHistoryCleared] = useState(false);

  const updateWebSearch = useCallback(
    async (next: WebSearchSettings) => {
      setIsSaving(true);
      setError(null);
      try {
        const updated = await settingsService.updateWebSearchSettings(next);
        onSettingsUpdated(updated.webSearch);
      } catch (updateError) {
        setError(extractErrorMessage(updateError));
      } finally {
        setIsSaving(false);
      }
    },
    [onSettingsUpdated]
  );

  const detectBrowsers = useCallback(async () => {
    setIsDetecting(true);
    setError(null);
    try {
      const detected = await settingsService.listDetectedBrowsers();
      setBrowsers(detected);

      if (
        settings.preferredBrowserId &&
        !detected.some((browser) => browser.id === settings.preferredBrowserId)
      ) {
        await updateWebSearch({ ...settings, preferredBrowserId: null });
      }
    } catch (detectionError) {
      setError(extractErrorMessage(detectionError));
    } finally {
      setIsDetecting(false);
    }
  }, [settings, updateWebSearch]);

  useEffect(() => {
    void detectBrowsers();
  }, [detectBrowsers]);

  return (
    <div className="settings-page">
      <SettingsPageHeader category="web-search" />
      <SettingsBody>
        <SettingsPluginSection page="web-search" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="web-search.defaults" showDescription>
            <SettingsRow rowId="web-search.defaults.engine" htmlFor="default-web-search-engine">
              <SettingsSelect
                id="default-web-search-engine"
                label={t('webSearch.defaultEngine')}
                value={settings.defaultEngine}
                options={[
                  { value: 'google', label: 'Google' },
                  { value: 'bing', label: 'Bing' },
                  { value: 'duckduckgo', label: 'DuckDuckGo' },
                ]}
                disabled={isSaving}
                onValueChange={(value) =>
                  void updateWebSearch({ ...settings, defaultEngine: value })
                }
              />
            </SettingsRow>
            <SettingsRow rowId="web-search.defaults.browser" htmlFor="preferred-browser">
              <div className="flex max-w-full items-center gap-2">
                <SettingsSelect
                  id="preferred-browser"
                  label={t('webSearch.browser')}
                  value={settings.preferredBrowserId ?? ''}
                  options={[
                    { value: '', label: t('webSearch.systemBrowser') },
                    ...browsers.map((browser) => ({ value: browser.id, label: browser.name })),
                  ]}
                  disabled={isDetecting || isSaving}
                  onValueChange={(value) =>
                    void updateWebSearch({ ...settings, preferredBrowserId: value || null })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isDetecting || isSaving}
                  onClick={() => void detectBrowsers()}
                  aria-label={t('webSearch.refreshBrowsers')}
                >
                  <RefreshCw className={isDetecting ? 'animate-spin' : undefined} />
                </Button>
              </div>
            </SettingsRow>
            {error && (
              <div className="p-2.5">
                <SettingsStatus kind="error">{error}</SettingsStatus>
              </div>
            )}
          </SettingsSection>
          <SettingsStatus>
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              {t('webSearch.securityNotice')}
            </span>
          </SettingsStatus>
          <SettingsSection sectionId="web-search.history">
            <SettingsRow rowId="web-search.history.remember">
              <Switch
                checked={rememberHistory}
                onCheckedChange={(checked) => {
                  setHistoryCleared(false);
                  onRememberHistoryChange(checked);
                }}
              />
            </SettingsRow>
            <SettingsRow rowId="web-search.history.clear">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (!window.confirm(t('webSearch.confirmClear'))) return;
                  webSearchHistory.clear();
                  setHistoryCleared(true);
                }}
              >
                {t('webSearch.clear')}
              </Button>
            </SettingsRow>
            {historyCleared && (
              <div className="p-2.5">
                <SettingsStatus kind="success">{t('webSearch.cleared')}</SettingsStatus>
              </div>
            )}
          </SettingsSection>
          <BraveKeySection />
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}
