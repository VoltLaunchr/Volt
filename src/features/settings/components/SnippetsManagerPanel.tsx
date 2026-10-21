import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, Toggle } from '../../../shared/components/ui';
import { logger } from '../../../shared/utils/logger';
import type { Snippet } from '../../plugins/builtin/snippets';

interface SnippetFormState {
  trigger: string;
  content: string;
  category: string;
  description: string;
  enabled: boolean;
}

const EMPTY_FORM: SnippetFormState = {
  trigger: '',
  content: '',
  category: '',
  description: '',
  enabled: true,
};

function toFormState(snippet: Snippet): SnippetFormState {
  return {
    trigger: snippet.trigger,
    content: snippet.content,
    category: snippet.category ?? '',
    description: snippet.description ?? '',
    enabled: snippet.enabled,
  };
}

/**
 * SnippetsManagerPanel — CRUD UI for the snippet library (`;trigger` text
 * expansion). Self-contained: snippets live in their own backend store
 * (`SnippetState`/`snippets.json`), independent of the main `Settings`
 * object, so this panel manages its own state rather than going through the
 * parent Settings window's `settings`/`updateSettings`.
 */
export function SnippetsManagerPanel(): React.JSX.Element {
  const { t } = useTranslation('settings');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<SnippetFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const loadSnippets = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const list = await invoke<Snippet[]>('get_snippets');
      setSnippets(list);
      setError(null);
    } catch (err) {
      logger.error('SnippetsManagerPanel: get_snippets failed', err);
      setError(t('snippetsManager.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  const openCreateModal = useCallback((): void => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((snippet: Snippet): void => {
    setEditingId(snippet.id);
    setForm(toFormState(snippet));
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback((): void => {
    setIsModalOpen(false);
  }, []);

  const handleToggleEnabled = useCallback(
    (snippet: Snippet, enabled: boolean): void => {
      setSnippets((prev) => prev.map((s) => (s.id === snippet.id ? { ...s, enabled } : s)));
      void invoke<Snippet>('update_snippet', { id: snippet.id, enabled }).catch((err) => {
        logger.error('SnippetsManagerPanel: update_snippet (toggle) failed', err);
        setSnippets((prev) =>
          prev.map((s) => (s.id === snippet.id ? { ...s, enabled: snippet.enabled } : s))
        );
        setError(t('snippetsManager.updateError'));
      });
    },
    [t]
  );

  const handleDelete = useCallback(
    (snippet: Snippet): void => {
      if (!window.confirm(t('snippetsManager.confirmDelete', { trigger: snippet.trigger }))) {
        return;
      }
      void (async () => {
        try {
          await invoke<void>('delete_snippet', { id: snippet.id });
          setSnippets((prev) => prev.filter((s) => s.id !== snippet.id));
        } catch (err) {
          logger.error('SnippetsManagerPanel: delete_snippet failed', err);
          setError(t('snippetsManager.deleteError'));
        }
      })();
    },
    [t]
  );

  const handleSave = useCallback((): void => {
    const trigger = form.trigger.trim();
    const content = form.content.trim();
    if (!trigger || !content) return;

    setIsSaving(true);
    void (async () => {
      try {
        const category = form.category.trim() || null;
        const description = form.description.trim() || null;

        if (editingId) {
          const updated = await invoke<Snippet>('update_snippet', {
            id: editingId,
            trigger,
            content,
            category,
            description,
            enabled: form.enabled,
          });
          setSnippets((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
        } else {
          const created = await invoke<Snippet>('create_snippet', {
            trigger,
            content,
            category,
            description,
          });
          setSnippets((prev) => [...prev, created]);
        }
        setError(null);
        setIsModalOpen(false);
      } catch (err) {
        logger.error('SnippetsManagerPanel: save snippet failed', err);
        setError(editingId ? t('snippetsManager.updateError') : t('snippetsManager.createError'));
      } finally {
        setIsSaving(false);
      }
    })();
  }, [form, editingId, t]);

  const canSave = form.trigger.trim().length > 0 && form.content.trim().length > 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-ink m-0">{t('snippetsManager.title')}</h3>
          <span className="text-xs text-mute">{t('snippetsManager.subtitle')}</span>
        </div>
        <Button variant="secondary" onClick={openCreateModal}>
          <Plus size={15} /> {t('snippetsManager.add')}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3.5 py-2.5 bg-accent-red/10 border border-accent-red/30 rounded-lg mb-3">
          <AlertCircle size={16} className="text-accent-red shrink-0 mt-0.5" />
          <p className="m-0 text-[13px] text-accent-red leading-relaxed">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5 mb-5">
        {isLoading ? (
          <p className="text-xs text-stone italic">{t('snippetsManager.loading')}</p>
        ) : snippets.length === 0 ? (
          <p className="text-xs text-stone italic">{t('snippetsManager.empty')}</p>
        ) : (
          snippets.map((snippet) => (
            <div
              key={snippet.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-surface-elevated/30 rounded-md border border-hairline"
            >
              <Toggle
                checked={snippet.enabled}
                onChange={(enabled) => handleToggleEnabled(snippet, enabled)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-on-dark font-mono font-medium">
                    {snippet.trigger}
                  </span>
                  {snippet.category && (
                    <span className="text-[11px] text-mute px-1.5 py-0.5 rounded-full border border-hairline">
                      {snippet.category}
                    </span>
                  )}
                </div>
                <p className="m-0 mt-0.5 text-xs text-mute truncate">
                  {snippet.description || snippet.content}
                </p>
              </div>
              <button
                className="w-7 h-7 rounded-sm bg-transparent border-none text-ash cursor-pointer flex items-center justify-center transition-all hover:bg-white/10 hover:text-on-dark"
                onClick={() => openEditModal(snippet)}
                aria-label={t('snippetsManager.edit')}
              >
                <Pencil size={14} />
              </button>
              <button
                className="w-7 h-7 rounded-sm bg-transparent border-none text-ash cursor-pointer flex items-center justify-center transition-all hover:bg-accent-red/15 hover:text-accent-red"
                onClick={() => handleDelete(snippet)}
                aria-label={t('snippetsManager.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? t('snippetsManager.editTitle') : t('snippetsManager.createTitle')}
        size="medium"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-body" htmlFor="snippet-trigger">
              {t('snippetsManager.triggerLabel')}
            </label>
            <input
              id="snippet-trigger"
              type="text"
              autoFocus
              className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark font-mono outline-none focus:border-hairline-strong placeholder:text-ash placeholder:font-sans"
              placeholder={t('snippetsManager.triggerPlaceholder')}
              value={form.trigger}
              onChange={(e) => setForm((prev) => ({ ...prev, trigger: e.target.value }))}
            />
            <span className="text-[11px] text-mute">{t('snippetsManager.triggerHint')}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-body" htmlFor="snippet-content">
              {t('snippetsManager.contentLabel')}
            </label>
            <textarea
              id="snippet-content"
              rows={5}
              className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash resize-none"
              placeholder={t('snippetsManager.contentPlaceholder')}
              value={form.content}
              onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
            />
            <span className="text-[11px] text-mute">{t('snippetsManager.contentHint')}</span>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-medium text-body" htmlFor="snippet-category">
                {t('snippetsManager.categoryLabel')}
              </label>
              <input
                id="snippet-category"
                type="text"
                className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash"
                placeholder={t('snippetsManager.categoryPlaceholder')}
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-medium text-body" htmlFor="snippet-description">
                {t('snippetsManager.descriptionLabel')}
              </label>
              <input
                id="snippet-description"
                type="text"
                className="bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash"
                placeholder={t('snippetsManager.descriptionPlaceholder')}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
          </div>

          {editingId && (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-body">{t('snippetsManager.enabledLabel')}</span>
              <Toggle
                checked={form.enabled}
                onChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={closeModal}>
              {t('snippetsManager.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!canSave || isSaving}>
              {isSaving ? t('snippetsManager.saving') : t('snippetsManager.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
