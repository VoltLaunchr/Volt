import { invoke } from '@tauri-apps/api/core';
import { formatDistanceToNow } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import { CloudDownload, CloudUpload, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { SettingsBody, SettingsPageHeader, SettingsStatus } from './SettingsChrome';
import { SettingsNote, SettingsRow, SettingsSection } from './SettingsPrimitives';

interface SyncStatus {
  lastSyncedAt: number | null;
  isPremium: boolean;
  isLoggedIn: boolean;
}

type SyncOp = 'push' | 'pull' | null;

export function SyncPanel() {
  const { t, i18n } = useTranslation('settings');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [activeOp, setActiveOp] = useState<SyncOp>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setStatusError(false);
    try {
      const s = await invoke<SyncStatus>('get_sync_status');
      if (!s) throw new Error('Sync status unavailable');
      setStatus(s);
    } catch {
      setStatusError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const runOp = async (op: 'push' | 'pull') => {
    setActiveOp(op);
    setFeedback(null);
    try {
      const s = await invoke<SyncStatus>(op === 'push' ? 'sync_push' : 'sync_pull');
      setStatus(s);
      setFeedback({
        type: 'success',
        message: op === 'push' ? t('sync.feedback.pushSuccess') : t('sync.feedback.pullSuccess'),
      });
    } catch (e: unknown) {
      // Tauri serializes Err(String) directly as a JS string for the rejection.
      const msg = typeof e === 'string' ? e : ((e as { message?: string })?.message ?? String(e));
      if (msg.includes('premium_required')) {
        setFeedback({ type: 'error', message: t('sync.feedback.premiumRequired') });
      } else if (msg.includes('not_logged_in')) {
        setFeedback({ type: 'error', message: t('sync.feedback.notLoggedIn') });
      } else {
        setFeedback({ type: 'error', message: `${t('sync.feedback.failed')}: ${msg}` });
      }
    } finally {
      setActiveOp(null);
    }
  };

  const isLocked = !status?.isLoggedIn || !status?.isPremium;
  const isBusy = activeOp !== null;
  const proBadge = isLocked ? (
    <Badge variant="outline">{t('navigation.badges.pro')}</Badge>
  ) : undefined;

  return (
    <div className="settings-page">
      <SettingsPageHeader category="sync" />
      <SettingsBody>
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
            {t('sync.loading')}
          </p>
        ) : statusError ? (
          <SettingsStatus
            kind="error"
            title={t('sync.statusErrorTitle')}
            action={
              <Button variant="secondary" onClick={() => void loadStatus()}>
                {t('navigation.retry')}
              </Button>
            }
          >
            {t('sync.statusErrorDesc')}
          </SettingsStatus>
        ) : (
          <>
            {isLocked && (
              <SettingsStatus
                title={status?.isLoggedIn ? t('sync.premiumBanner.title') : t('sync.signInTitle')}
              >
                <span className="flex items-center gap-2">
                  <Lock className="size-4 shrink-0" aria-hidden="true" />
                  {status?.isLoggedIn
                    ? t('sync.premiumBanner.upgradeHint')
                    : t('sync.premiumBanner.loginHint')}
                </span>
              </SettingsStatus>
            )}
            <SettingsSection sectionId="sync.cloud" showDescription>
              <SettingsRow
                rowId="sync.cloud.push"
                icon={<CloudUpload size={18} />}
                badge={proBadge}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isBusy || isLocked}
                  onClick={() => void runOp('push')}
                >
                  {activeOp === 'push' && (
                    <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                  )}
                  {t('sync.push.action')}
                </Button>
              </SettingsRow>
              <SettingsRow
                rowId="sync.cloud.pull"
                icon={<CloudDownload size={18} />}
                badge={proBadge}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isBusy || isLocked}
                  onClick={() => void runOp('pull')}
                >
                  {activeOp === 'pull' && (
                    <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                  )}
                  {t('sync.pull.action')}
                </Button>
              </SettingsRow>
              {status?.lastSyncedAt ? (
                <SettingsNote>
                  {t('sync.lastSynced')}{' '}
                  {formatDistanceToNow(new Date(status.lastSyncedAt * 1000), {
                    addSuffix: true,
                    locale: i18n.resolvedLanguage?.startsWith('fr') ? fr : enUS,
                  })}
                </SettingsNote>
              ) : null}
            </SettingsSection>
            {feedback && <SettingsStatus kind={feedback.type}>{feedback.message}</SettingsStatus>}
          </>
        )}
      </SettingsBody>
    </div>
  );
}
