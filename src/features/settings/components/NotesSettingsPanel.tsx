import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FilePlus, Trash2, StickyNote } from 'lucide-react';
import { Button } from '../../../shared/components/ui';
import { logger } from '../../../shared/utils/logger';

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
export function NotesSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings');
  const [stats, setStats] = useState<NotesStats>({ active: 0, trashed: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshStats = useCallback(async (): Promise<void> => {
    try {
      const [active, trashed] = await Promise.all([
        invoke<Note[]>('get_notes'),
        invoke<Note[]>('get_trash'),
      ]);
      setStats({ active: active.length, trashed: trashed.length });
    } catch (err) {
      logger.error('NotesSettingsPanel: refreshStats failed', err);
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
    if (!window.confirm(t('notes.confirmEmpty', { count: stats.trashed }))) return;
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
          }),
        );
      } finally {
        setBusy(null);
      }
    })();
  }, [stats.trashed, refreshStats, flashStatus, t]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-hairline px-6">
        <h2 className="m-0 text-sm font-medium text-ink">
          {t('notes.title', 'Notes')}
        </h2>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {/* Hero card */}
        <section className="rounded-lg border border-hairline bg-surface p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-blue/15 text-accent-blue">
              <StickyNote size={22} />
            </div>
            <div className="flex-1">
              <h3 className="m-0 text-base font-semibold text-ink">
                {t('notes.headline', 'Markdown notes with full-text search')}
              </h3>
              <p className="mt-1 mb-0 text-sm text-mute">
                {t(
                  'notes.tagline',
                  'Capture, search, and organize notes. Stored locally in SQLite with FTS5 search.',
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mute">
                <span className="rounded-full border border-hairline px-2 py-0.5">
                  {t('notes.active', { count: stats.active })}
                </span>
                <span className="rounded-full border border-hairline px-2 py-0.5">
                  {t('notes.trashed', { count: stats.trashed })}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleOpenNotes}>
                <ExternalLink size={14} />
                <span className="ml-1.5">{t('notes.openWindow', 'Open Notes')}</span>
              </Button>
              <Button variant="outline" onClick={handleCreateNote}>
                <FilePlus size={14} />
                <span className="ml-1.5">{t('notes.create', 'Create Note')}</span>
              </Button>
            </div>
          </div>
        </section>

        {/* Commands quick-reference */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">
            {t('notes.commandsTitle', 'Commands')}
          </h3>
          <div className="overflow-hidden rounded-lg border border-hairline">
            <CommandRow
              title={t('notes.cmd.open', 'Open Notes')}
              subtitle={t('notes.cmd.openDesc', 'Open the dedicated Notes window')}
              shortcut="n"
              icon={<ExternalLink size={14} />}
            />
            <CommandRow
              title={t('notes.cmd.create', 'Create Note')}
              subtitle={t('notes.cmd.createDesc', 'Start a fresh note in the editor')}
              shortcut="Cmd+N"
              icon={<FilePlus size={14} />}
            />
            <CommandRow
              title={t('notes.cmd.search', 'Search Notes')}
              subtitle={t('notes.cmd.searchDesc', 'Full-text search via the launcher (n <query>)')}
              shortcut="n <q>"
              icon={<StickyNote size={14} />}
              last
            />
          </div>
        </section>

        {/* Trash section */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">
            {t('notes.trashTitle', 'Trash')}
          </h3>
          <div className="rounded-lg border border-hairline bg-surface p-4">
            <p className="m-0 text-sm text-mute">
              {t(
                'notes.trashDesc',
                'Deleted notes stay in trash and can be restored from the Notes window. Empty the trash to permanently remove them.',
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={handleEmptyTrash}
                disabled={busy === 'empty-trash' || stats.trashed === 0}
                variant="destructive"
              >
                <Trash2 size={14} />
                <span className="ml-1.5">
                  {busy === 'empty-trash'
                    ? t('notes.emptyingTrash', 'Emptying…')
                    : t('notes.emptyTrash', 'Empty Trash')}
                  {stats.trashed > 0 && ` (${stats.trashed})`}
                </span>
              </Button>
            </div>
          </div>
        </section>

        {status && (
          <div
            className={
              status.kind === 'ok'
                ? 'rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'
                : 'rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400'
            }
            role="status"
          >
            {status.text}
          </div>
        )}
      </div>
    </div>
  );
}

interface CommandRowProps {
  title: string;
  subtitle: string;
  shortcut: string;
  icon: React.ReactNode;
  last?: boolean;
}

function CommandRow({ title, subtitle, shortcut, icon, last }: CommandRowProps): React.JSX.Element {
  return (
    <div
      className={
        last
          ? 'flex items-center gap-3 px-4 py-3'
          : 'flex items-center gap-3 border-b border-hairline px-4 py-3'
      }
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hairline/40 text-ink">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="m-0 text-sm font-medium text-ink">{title}</p>
        <p className="m-0 text-xs text-mute">{subtitle}</p>
      </div>
      <kbd className="shrink-0 rounded border border-hairline bg-canvas px-2 py-0.5 font-mono text-xs text-mute">
        {shortcut}
      </kbd>
    </div>
  );
}
