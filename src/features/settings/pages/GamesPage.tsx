import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { logger } from '../../../shared/utils/logger';
import type { PlatformInfo } from '../../plugins/builtin/games';
import { SettingsBody, SettingsPageHeader, SettingsStatus } from '../components/SettingsChrome';
import {
  SettingsGate,
  SettingsList,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from '../components/SettingsPrimitives';

/** Game stores detected by the scanner, with a manual rescan. */
export function GamesPage({ pluginState }: { pluginState: SettingsPluginState }) {
  const { t } = useTranslation('settings');
  const [platforms, setPlatforms] = useState<PlatformInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);

  const loadPlatforms = useCallback(async () => {
    setLoadFailed(false);
    try {
      setPlatforms(await invoke<PlatformInfo[]>('get_game_platforms'));
    } catch (error) {
      logger.error('Failed to list game platforms:', error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadPlatforms();
  }, [loadPlatforms]);

  const rescan = async () => {
    setScanning(true);
    setScanned(null);
    try {
      setScanned(await invoke<number>('rescan_all_games'));
      await loadPlatforms();
    } catch (error) {
      logger.error('Failed to rescan games:', error);
      setLoadFailed(true);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="settings-page">
      <SettingsPageHeader category="games" />
      <SettingsBody>
        <SettingsPluginSection page="games" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="games.library" showDescription>
            <SettingsRow rowId="games.library.platforms" stacked>
              {loadFailed ? (
                <SettingsStatus
                  kind="error"
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void loadPlatforms()}>
                      {t('navigation.retry')}
                    </Button>
                  }
                >
                  {t('games.loadFailed')}
                </SettingsStatus>
              ) : platforms === null ? (
                <p role="status" className="m-0 text-xs text-muted-foreground">
                  {t('games.loading')}
                </p>
              ) : (
                <SettingsList label={t('games.platforms')} empty={t('games.noPlatforms')}>
                  {platforms.length > 0
                    ? platforms.map((platform) => (
                        <div
                          key={platform.id}
                          role="listitem"
                          className="settings-list__item settings-list__item--static"
                        >
                          <span className="settings-list__title flex-1">{platform.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {t('games.gameCount', { count: platform.gameCount })}
                          </span>
                          <Badge variant={platform.isInstalled ? 'secondary' : 'outline'}>
                            {platform.isInstalled ? t('games.detected') : t('games.notDetected')}
                          </Badge>
                        </div>
                      ))
                    : null}
                </SettingsList>
              )}
            </SettingsRow>
            <SettingsRow rowId="games.library.rescan">
              <Button
                variant="secondary"
                size="sm"
                disabled={scanning}
                onClick={() => void rescan()}
              >
                {scanning ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size={14} aria-hidden="true" />
                )}
                {scanning ? t('games.rescanning') : t('games.rescanAction')}
              </Button>
            </SettingsRow>
            {scanned !== null && (
              <div className="p-2.5">
                <SettingsStatus kind="success">
                  {t('games.rescanned', { count: scanned })}
                </SettingsStatus>
              </div>
            )}
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}
