import { invoke } from '@tauri-apps/api/core';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, CheckCircle, CloudDownload, CloudUpload, Lock, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SyncStatus {
  lastSyncedAt: number | null;
  isPremium: boolean;
  isLoggedIn: boolean;
}

type SyncOp = 'push' | 'pull' | null;

export function SyncPanel() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeOp, setActiveOp] = useState<SyncOp>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await invoke<SyncStatus>('get_sync_status');
      setStatus(s);
    } catch {
      // ignore
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

  const isLocked = !status?.isPremium;
  const isBusy = activeOp !== null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 h-14 px-6 border-b border-hairline shrink-0">
        <h2 className="text-sm font-medium text-ink m-0">{t('sync.title')}</h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-[rgba(99,102,241,0.12)] text-[var(--color-accent)] border border-[rgba(99,102,241,0.25)]">
          {t('sync.comingSoon')}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-mute text-[13px]">
            <RefreshCw size={13} className="animate-spin" />
            {t('sync.loading')}
          </div>
        ) : (
          <div className="flex flex-col gap-5 max-w-[560px]">
            <p className="text-[13px] text-mute m-0">{t('sync.description')}</p>

            {/* Premium gate banner */}
            {isLocked && (
              <div className="flex items-start gap-3 p-3.5 rounded-[10px] bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.2)]">
                <Lock size={15} className="text-[var(--color-accent)] shrink-0 mt-px" />
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)] m-0 mb-1">
                    {t('sync.premiumBanner.title')}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] m-0">
                    {status?.isLoggedIn
                      ? t('sync.premiumBanner.upgradeHint')
                      : t('sync.premiumBanner.loginHint')}
                  </p>
                </div>
              </div>
            )}

            {/* Push card */}
            <SyncCard
              icon={<CloudUpload size={16} />}
              title={t('sync.push.title')}
              description={t('sync.push.description')}
              actionLabel={t('sync.push.action')}
              loading={activeOp === 'push'}
              disabled={isBusy || isLocked}
              onClick={() => {
                void runOp('push');
              }}
            />

            {/* Pull card */}
            <SyncCard
              icon={<CloudDownload size={16} />}
              title={t('sync.pull.title')}
              description={t('sync.pull.description')}
              actionLabel={t('sync.pull.action')}
              loading={activeOp === 'pull'}
              disabled={isBusy || isLocked}
              onClick={() => {
                void runOp('pull');
              }}
            />

            {/* Last synced */}
            {status?.lastSyncedAt && (
              <p className="text-xs text-[var(--color-text-secondary)] m-0">
                {t('sync.lastSynced')}{' '}
                {formatDistanceToNow(new Date(status.lastSyncedAt * 1000), { addSuffix: true })}
              </p>
            )}

            {/* Feedback */}
            {feedback && (
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] ${
                  feedback.type === 'success'
                    ? 'bg-[rgba(34,197,94,0.1)] text-[var(--color-accent-green)]'
                    : 'bg-[rgba(239,68,68,0.1)] text-[var(--color-accent-red)]'
                }`}
              >
                {feedback.type === 'success' ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                {feedback.message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SyncCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

function SyncCard({ icon, title, description, actionLabel, loading, disabled, onClick }: SyncCardProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-[10px] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="flex items-start gap-3">
        <span className="text-[var(--color-text-secondary)] mt-0.5 shrink-0">{icon}</span>
        <div>
          <p className="text-[13px] font-medium text-[var(--color-text-primary)] m-0 mb-[3px]">{title}</p>
          <p className="text-xs text-[var(--color-text-secondary)] m-0 max-w-[320px]">{description}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium border-0 transition-opacity duration-150 ${
          disabled
            ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] cursor-not-allowed opacity-60'
            : 'bg-[var(--color-accent)] text-white cursor-pointer'
        }`}
      >
        {loading && <RefreshCw size={11} className="animate-spin" />}
        {actionLabel}
      </button>
    </div>
  );
}
