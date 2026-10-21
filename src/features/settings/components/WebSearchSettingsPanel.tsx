import { useCallback, useEffect, useState } from 'react';
import { Globe2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Toggle } from '../../../shared/components/ui';
import { extractErrorMessage } from '../../../shared/utils/error';
import { settingsService, type DetectedBrowser } from '../services/settingsService';
import type { WebSearchEngine, WebSearchSettings } from '../types/settings.types';

interface WebSearchSettingsPanelProps {
  settings: WebSearchSettings;
  rememberHistory: boolean;
  onSettingsUpdated: (settings: WebSearchSettings) => void;
  onRememberHistoryChange: (enabled: boolean) => void;
}

export function WebSearchSettingsPanel({
  settings,
  rememberHistory,
  onSettingsUpdated,
  onRememberHistoryChange,
}: WebSearchSettingsPanelProps) {
  const { t } = useTranslation('settings');
  const [browsers, setBrowsers] = useState<DetectedBrowser[]>([]);
  const [isDetecting, setIsDetecting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('webSearch.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-accent-blue/20 bg-accent-blue/8 px-3.5 py-3.5">
          <Globe2 size={20} className="mt-0.5 shrink-0 text-accent-blue" />
          <p className="m-0 text-[13px] leading-relaxed text-body">{t('webSearch.description')}</p>
        </div>

        <section aria-labelledby="web-search-defaults-title">
          <div className="mb-2 flex items-center gap-2">
            <Search size={16} className="text-accent-blue" />
            <h3 id="web-search-defaults-title" className="m-0 text-sm font-semibold text-ink">
              {t('webSearch.searchDefaults')}
            </h3>
          </div>

          <div className="flex items-center justify-between gap-5 border-b border-hairline py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor="default-web-search-engine" className="text-sm text-body">
                {t('webSearch.defaultEngine')}
              </label>
              <span className="text-xs text-mute">{t('webSearch.defaultEngineDesc')}</span>
            </div>
            <select
              id="default-web-search-engine"
              className="min-w-40 cursor-pointer rounded-md border border-hairline bg-surface-elevated px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong disabled:cursor-wait disabled:opacity-60"
              value={settings.defaultEngine}
              disabled={isSaving}
              onChange={(event) => {
                void updateWebSearch({
                  ...settings,
                  defaultEngine: event.target.value as WebSearchEngine,
                });
              }}
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="duckduckgo">DuckDuckGo</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-5 border-b border-hairline py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor="preferred-browser" className="text-sm text-body">
                {t('webSearch.browser')}
              </label>
              <span className="text-xs text-mute">{t('webSearch.browserDesc')}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                id="preferred-browser"
                className="min-w-52 cursor-pointer rounded-md border border-hairline bg-surface-elevated px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong disabled:cursor-wait disabled:opacity-60"
                value={settings.preferredBrowserId ?? ''}
                disabled={isDetecting || isSaving}
                onChange={(event) => {
                  void updateWebSearch({
                    ...settings,
                    preferredBrowserId: event.target.value || null,
                  });
                }}
              >
                <option value="">{t('webSearch.systemBrowser')}</option>
                {browsers.map((browser) => (
                  <option key={browser.id} value={browser.id}>
                    {browser.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-md border border-hairline bg-surface-elevated text-ash transition-colors hover:text-on-dark focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong disabled:cursor-wait disabled:opacity-50"
                onClick={() => {
                  void detectBrowsers();
                }}
                disabled={isDetecting || isSaving}
                aria-label={t('webSearch.refreshBrowsers')}
                title={t('webSearch.refreshBrowsers')}
              >
                <RefreshCw size={14} className={isDetecting ? 'animate-spin' : undefined} />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-5 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-body">{t('webSearch.rememberHistory')}</span>
              <span className="text-xs text-mute">{t('webSearch.rememberHistoryDesc')}</span>
            </div>
            <Toggle
              id="remember-web-search-history"
              checked={rememberHistory}
              onChange={onRememberHistoryChange}
            />
          </div>
        </section>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-hairline bg-surface-elevated/30 px-3.5 py-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent-green" />
          <p className="m-0 text-xs leading-relaxed text-mute">{t('webSearch.securityNotice')}</p>
        </div>

        {error && (
          <p role="alert" className="mb-0 mt-3 text-xs text-accent-red">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
