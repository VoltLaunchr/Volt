import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Package,
  RefreshCw,
  Upload,
} from 'lucide-react';
import logo from '../../../assets/icons/logo.svg';
import { Button, Spinner } from '../../../shared/components/ui';
import { Badge } from '@/shared/components/ui/badge';
import { Switch } from '@/shared/components/ui/switch';
import { logger } from '../../../shared/utils/logger';
import {
  SettingsBody,
  SettingsPageHeader,
  SettingsSelect,
  SettingsStatus,
} from '../components/SettingsChrome';
import { SettingsRow, SettingsSection } from '../components/SettingsPrimitives';
import type { UpdateController } from '../hooks/useUpdateController';
import { settingsService } from '../services/settingsService';
import { isMicrosoftStoreManaged, isPackageManagerManaged } from '../services/updateService';
import type { GeneralSettings, Settings, UpdateChannel } from '../types/settings.types';

const LINKS = [
  { id: 'website', titleUrl: 'https://voltlaunchr.com' },
  { id: 'github', titleUrl: 'https://github.com/VoltLaunchr/Volt' },
  { id: 'issue', titleUrl: 'https://github.com/VoltLaunchr/Volt/issues/new' },
  { id: 'releaseNotes', titleUrl: 'https://github.com/VoltLaunchr/Volt/blob/main/CHANGELOG.md' },
] as const;

const STATUS_MS = 3000;

interface AboutPageProps {
  version: string;
  general: GeneralSettings;
  /** Persists a change of the general settings immediately (no save bar). */
  onGeneralChange: (patch: Partial<GeneralSettings>) => void;
  update: UpdateController;
  onSettingsImported: (settings: Settings) => void;
}

async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch (error) {
    logger.error('Failed to open URL:', error);
  }
}

async function openLogsFolder(): Promise<void> {
  try {
    const logPath = await invoke<string>('get_log_file_path');
    try {
      const opener = await import('@tauri-apps/plugin-opener');
      if (typeof opener.revealItemInDir === 'function') {
        await opener.revealItemInDir(logPath);
        return;
      }
      if (typeof opener.openPath === 'function') {
        await opener.openPath(logPath);
        return;
      }
      logger.error('No supported opener API found for revealing logs folder');
    } catch (innerError) {
      logger.error('Failed to open logs folder:', innerError);
    }
  } catch (error) {
    logger.error('Failed to resolve log file path:', error);
  }
}

/** Version, update flow, diagnostics and settings backup. */
export function AboutPage({
  version,
  general,
  onGeneralChange,
  update,
  onSettingsImported,
}: AboutPageProps) {
  const { t } = useTranslation('settings');
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const later = useCallback((callback: () => void, delay: number) => {
    timers.current.push(window.setTimeout(callback, delay));
  }, []);

  const copyDiagnostics = async () => {
    try {
      let logPath = '(unavailable)';
      try {
        logPath = await invoke<string>('get_log_file_path');
      } catch (error) {
        logger.error('Failed to resolve log file path for diagnostics:', error);
      }
      const lines = [
        'Volt Diagnostics',
        '================',
        `App: Volt`,
        `Version: ${version}`,
        `Platform: ${navigator.platform}`,
        `User Agent: ${navigator.userAgent}`,
        `Log file path: ${logPath}`,
        `Timestamp: ${new Date().toISOString()}`,
      ];
      await navigator.clipboard.writeText(lines.join('\n'));
      setDiagnosticsCopied(true);
      later(() => setDiagnosticsCopied(false), 1500);
    } catch (error) {
      logger.error('Failed to copy diagnostics:', error);
    }
  };

  const flashBackup = (kind: 'success' | 'error', message: string) => {
    setBackupStatus({ kind, message });
    later(() => setBackupStatus(null), STATUS_MS);
  };

  const exportSettings = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'volt-settings.json',
      });
      if (!path) return;
      await settingsService.exportSettings(path);
      flashBackup('success', t('about.exportSuccess'));
    } catch (error) {
      logger.error('Failed to export settings:', error);
      flashBackup('error', t('about.exportError'));
    }
  };

  const importSettings = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });
      if (!path) return;
      onSettingsImported(await settingsService.importSettings(path));
      flashBackup('success', t('about.importSuccess'));
    } catch (error) {
      logger.error('Failed to import settings:', error);
      flashBackup('error', t('about.importError'));
    }
  };

  const channel: UpdateChannel = general.updateChannel ?? 'stable';
  const busy = update.isUpdating || update.isDeferring;

  const renderUpdatePanel = () => {
    if (isPackageManagerManaged()) {
      return (
        <SettingsStatus>
          <span className="flex items-center gap-2">
            <Package size={16} className="shrink-0" aria-hidden="true" />
            {t(
              isMicrosoftStoreManaged()
                ? 'about.microsoftStoreManaged'
                : 'about.packageManagerManaged'
            )}
          </span>
        </SettingsStatus>
      );
    }
    const { info } = update;
    return (
      <div className="flex flex-col gap-2">
        {update.deferralReady && (
          <SettingsStatus
            kind="success"
            action={
              <Button variant="ghost" size="sm" onClick={update.cancelDeferral}>
                {t('about.cancelDeferral')}
              </Button>
            }
          >
            {t('about.deferralReady')}
          </SettingsStatus>
        )}
        {!update.checked && !update.isChecking && !update.deferralReady && (
          <div>
            <Button onClick={() => void update.check()}>
              <RefreshCw size={14} aria-hidden="true" />
              {t('about.checkForUpdates')}
            </Button>
          </div>
        )}
        {update.isChecking && (
          <SettingsStatus>
            <span className="flex items-center gap-2" role="status">
              <Spinner size="small" />
              {t('about.checking')}
            </span>
          </SettingsStatus>
        )}
        {update.checked && !info && !update.isChecking && (
          <SettingsStatus
            kind="success"
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('about.checkForUpdates')}
                onClick={() => void update.check()}
              >
                <RefreshCw size={14} aria-hidden="true" />
              </Button>
            }
          >
            {t('about.upToDate')}
          </SettingsStatus>
        )}
        {info && !busy && (
          <div className="flex flex-col gap-2">
            {info.critical && (
              <SettingsStatus kind="error">{t('about.criticalUpdate')}</SettingsStatus>
            )}
            <div className="flex items-center gap-2 text-[13px]">
              <span>{t('about.updateAvailable')}</span>
              <Badge variant="secondary">
                v{info.version}
                {info.isBeta ? ' beta' : ''}
              </Badge>
            </div>
            {info.body && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">{t('about.whatsNew')}</span>
                <div className="max-h-[150px] overflow-y-auto whitespace-pre-wrap rounded-md bg-foreground/5 p-2 text-xs leading-relaxed text-muted-foreground">
                  {info.body}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {info.isBeta ? (
                <Button
                  onClick={() => void openExternal('https://github.com/VoltLaunchr/Volt/releases')}
                >
                  <Download size={14} aria-hidden="true" />
                  {t('about.downloadFromGitHub')}
                </Button>
              ) : (
                <>
                  <Button onClick={() => void update.installNow()}>
                    <Download size={14} aria-hidden="true" />
                    {t('about.downloadAndInstall')}
                  </Button>
                  {!info.critical && (
                    <Button variant="outline" onClick={() => void update.installOnRestart()}>
                      <Download size={14} aria-hidden="true" />
                      {t('about.installOnNextRestart')}
                    </Button>
                  )}
                </>
              )}
              {!info.critical && (
                <>
                  <Button variant="ghost" size="sm" onClick={update.snooze}>
                    {t('about.remindLater')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={update.skip}>
                    {t('about.skipVersion')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {busy && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[13px]" role="status">
              <Spinner size="small" />
              <span>
                {update.isDeferring
                  ? t('about.deferring')
                  : update.progress < 100
                    ? t('about.downloading')
                    : t('about.installing')}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={update.progress}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${update.progress}%` }}
              />
            </div>
            <span className="text-right text-xs text-muted-foreground">{update.progress}%</span>
          </div>
        )}
        {update.error && (
          <SettingsStatus kind="error">
            <span className="flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
              {update.error}
            </span>
          </SettingsStatus>
        )}
      </div>
    );
  };

  return (
    <div className="settings-page">
      <SettingsPageHeader category="about" />
      <SettingsBody>
        <div className="flex flex-col items-center px-4 py-4 text-center">
          <img src={logo} alt="" className="mb-3 size-16 object-contain" />
          <h2 className="m-0 text-xl font-semibold">Volt</h2>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
            {t('about.version', { version })}
          </p>
          <p className="m-0 max-w-[400px] text-xs text-muted-foreground">
            {t('about.description')}
          </p>
        </div>

        <SettingsSection sectionId="about.links">
          {LINKS.map(({ id, titleUrl }) => (
            <SettingsRow key={id} rowId={`about.links.${id}`}>
              <Button variant="secondary" size="sm" onClick={() => void openExternal(titleUrl)}>
                <ExternalLink size={14} aria-hidden="true" />
                {t('about.open')}
              </Button>
            </SettingsRow>
          ))}
        </SettingsSection>

        <SettingsSection sectionId="about.updates">
          <SettingsRow rowId="about.updates.auto">
            <Switch
              checked={general.autoCheckForUpdates ?? true}
              onCheckedChange={(checked) => onGeneralChange({ autoCheckForUpdates: checked })}
            />
          </SettingsRow>
          <SettingsRow rowId="about.updates.channel" htmlFor="about-update-channel">
            <SettingsSelect
              id="about-update-channel"
              label={t('about.channelTitle')}
              value={channel}
              options={[
                { value: 'stable', label: t('about.channelStable') },
                { value: 'beta', label: t('about.channelBeta') },
              ]}
              onValueChange={(value) => onGeneralChange({ updateChannel: value })}
            />
          </SettingsRow>
          <SettingsRow rowId="about.updates.check" stacked>
            {renderUpdatePanel()}
          </SettingsRow>
        </SettingsSection>

        <SettingsSection sectionId="about.diagnostics">
          <SettingsRow rowId="about.diagnostics.logs">
            <Button variant="secondary" size="sm" onClick={() => void openLogsFolder()}>
              <FolderOpen size={14} aria-hidden="true" />
              {t('about.open')}
            </Button>
          </SettingsRow>
          <SettingsRow rowId="about.diagnostics.copy">
            <Button variant="secondary" size="sm" onClick={() => void copyDiagnostics()}>
              {diagnosticsCopied ? (
                <CheckCircle size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {diagnosticsCopied ? t('about.copied') : t('about.copyDiagnostics')}
            </Button>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection sectionId="about.backup">
          <SettingsRow rowId="about.backup.export">
            <Button variant="secondary" size="sm" onClick={() => void exportSettings()}>
              <Download size={14} aria-hidden="true" />
              {t('about.exportSettings')}
            </Button>
          </SettingsRow>
          <SettingsRow rowId="about.backup.import">
            <Button variant="secondary" size="sm" onClick={() => void importSettings()}>
              <Upload size={14} aria-hidden="true" />
              {t('about.importSettings')}
            </Button>
          </SettingsRow>
          {backupStatus && (
            <div className="p-2.5">
              <SettingsStatus kind={backupStatus.kind}>{backupStatus.message}</SettingsStatus>
            </div>
          )}
        </SettingsSection>

        <div className="text-center">
          <p className="my-1 text-xs text-muted-foreground">{t('about.copyright')}</p>
          <p className="my-1 text-xs text-muted-foreground">{t('about.builtWith')}</p>
        </div>
      </SettingsBody>
    </div>
  );
}
