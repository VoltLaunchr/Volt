import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FilePlus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { logger } from '../../../shared/utils/logger';
import { SettingsBody, SettingsPageHeader, SettingsStatus } from './SettingsChrome';
import {
  SettingsGate,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from './SettingsPrimitives';

interface Note {
  id: string;
  deletedAt: number | null;
}

interface NotesStats {
  active: number;
  trashed: number;
}

/**
 * NotesSettingsPanel — Notes management panel inside the Settings window.
 *
 * v1 surface: stats, "Open Notes" / "Create Note" buttons, and trash
 * management. Backup (export/import to disk) lands in a follow-up once the
 * backend exposes file-path commands so we don't need the FS plugin here.
 */
export function NotesSettingsPanel({
  pluginState,
}: {
  pluginState: SettingsPluginState;
}): React.JSX.Element {
  const { t } = useTranslation('settings');
  const [stats, setStats] = useState<NotesStats>({ active: 0, trashed: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshStats = useCallback(async (): Promise<void> => {
    setStatsLoading(true);
    setStatsError(false);
    try {
      const [active, trashed] = await Promise.all([
        invoke<Note[]>('get_notes'),
        invoke<Note[]>('get_trash'),
      ]);
      setStats({ active: active.length, trashed: trashed.length });
    } catch (err) {
      logger.error('NotesSettingsPanel: refreshStats failed', err);
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const flashStatus = useCallback((kind: 'ok' | 'err', text: string): void => {
    setStatus({ kind, text });
    window.setTimeout(() => {
      setStatus(null);
    }, 4000);
  }, []);

  const handleOpenNotes = useCallback((): void => {
    void (async () => {
      try {
        await invoke<void>('open_notes_window', { noteId: null });
      } catch (err) {
        logger.error('NotesSettingsPanel: open_notes_window failed', err);
      }
    })();
  }, []);

  const handleCreateNote = useCallback((): void => {
    void (async () => {
      try {
        const created = await invoke<{ id: string }>('create_note', {
          title: null,
          content: null,
          tags: null,
        });
        await invoke<void>('open_notes_window', { noteId: created.id });
        await refreshStats();
      } catch (err) {
        logger.error('NotesSettingsPanel: create_note failed', err);
      }
    })();
  }, [refreshStats]);

  const handleEmptyTrash = useCallback((): void => {
    if (stats.trashed === 0) return;
    setConfirmEmpty(false);
    setBusy('empty-trash');
    void (async () => {
      try {
        const removed = await invoke<number>('empty_trash');
        await refreshStats();
        flashStatus('ok', t('notes.removed', { count: removed }));
      } catch (err) {
        logger.error('NotesSettingsPanel: empty_trash failed', err);
        flashStatus(
          'err',
          t('notes.emptyFailed', {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      } finally {
        setBusy(null);
      }
    })();
  }, [stats.trashed, refreshStats, flashStatus, t]);

  const countsDescription = statsLoading
    ? t('loading')
    : statsError
      ? undefined
      : t('notes.counts', { active: stats.active, trashed: stats.trashed });

  return (
    <div className="settings-page">
      <SettingsPageHeader category="notes" />
      <SettingsBody>
        <SettingsPluginSection page="notes" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          {statsError && (
            <SettingsStatus
              kind="error"
              action={
                <Button variant="outline" onClick={() => void refreshStats()}>
                  {t('navigation.retry')}
                </Button>
              }
            >
              {t('notes.loadFailed')}
            </SettingsStatus>
          )}
          <SettingsSection sectionId="notes.library" showDescription>
            <SettingsRow rowId="notes.library.open" description={countsDescription}>
              <Button size="sm" onClick={handleOpenNotes}>
                <ExternalLink size={14} aria-hidden="true" />
                {t('notes.openWindow')}
              </Button>
            </SettingsRow>
            <SettingsRow rowId="notes.library.create">
              <Button variant="secondary" size="sm" onClick={handleCreateNote}>
                <FilePlus size={14} aria-hidden="true" />
                {t('notes.create')}
              </Button>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection sectionId="notes.commands">
            <SettingsRow rowId="notes.commands.open">
              <kbd className="settings-kbd">n</kbd>
            </SettingsRow>
            <SettingsRow rowId="notes.commands.create">
              <kbd className="settings-kbd">Cmd+N</kbd>
            </SettingsRow>
            <SettingsRow rowId="notes.commands.search">
              <kbd className="settings-kbd">n &lt;q&gt;</kbd>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection sectionId="notes.trash" showDescription>
            <SettingsRow rowId="notes.trash.empty">
              <Button
                variant="destructive"
                size="sm"
                disabled={
                  busy === 'empty-trash' || stats.trashed === 0 || statsLoading || statsError
                }
                onClick={() => setConfirmEmpty(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                {busy === 'empty-trash' ? t('notes.emptyingTrash') : t('notes.emptyTrash')}
                {stats.trashed > 0 && ` (${stats.trashed})`}
              </Button>
            </SettingsRow>
          </SettingsSection>
          {status && (
            <SettingsStatus kind={status.kind === 'ok' ? 'success' : 'error'}>
              {status.text}
            </SettingsStatus>
          )}
        </SettingsGate>
      </SettingsBody>
      <Dialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('notes.emptyTrash')}</DialogTitle>
            <DialogDescription>
              {t('notes.confirmEmpty', { count: stats.trashed })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEmpty(false)}>
              {t('navigation.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleEmptyTrash}>
              {t('notes.emptyTrash')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
