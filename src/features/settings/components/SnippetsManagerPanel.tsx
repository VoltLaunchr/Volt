import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Switch } from '@/shared/components/ui/switch';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { SettingsField, SettingsStatus } from './SettingsChrome';
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './SettingsPrimitives';
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
  const [pendingDelete, setPendingDelete] = useState<Snippet | null>(null);
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
      setPendingDelete(null);
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
    <>
      <SettingsSection sectionId="snippets.library" showDescription>
        <SettingsNote>
          {t('snippetExpansion.infoText')} <kbd>;</kbd> {t('snippetExpansion.infoTextSuffix')}
        </SettingsNote>
        <SettingsRow rowId="snippets.library.new">
          <Button variant="secondary" size="sm" onClick={openCreateModal}>
            <Plus size={14} aria-hidden="true" />
            {t('snippetsManager.add')}
          </Button>
        </SettingsRow>
        {error && !isModalOpen && (
          <div className="p-2.5">
            <SettingsStatus kind="error">{error}</SettingsStatus>
          </div>
        )}
        {isLoading ? (
          <SettingsNote>
            <span role="status">{t('snippetsManager.loading')}</span>
          </SettingsNote>
        ) : snippets.length === 0 ? (
          <SettingsNote>{t('snippetsManager.empty')}</SettingsNote>
        ) : (
          <SettingsList label={t('snippetsManager.title')}>
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                role="listitem"
                className="settings-list__item settings-list__item--static"
              >
                <Switch
                  checked={snippet.enabled}
                  onCheckedChange={(enabled) => handleToggleEnabled(snippet, enabled)}
                  aria-label={`${t('snippetsManager.enabledLabel')} ${snippet.trigger}`}
                />
                <div className="settings-list__text">
                  <span className="settings-list__title">
                    <code className="font-medium">{snippet.trigger}</code>
                    {snippet.category && (
                      <Badge variant="outline" className="ml-2 align-middle">
                        {snippet.category}
                      </Badge>
                    )}
                  </span>
                  <span className="settings-list__meta">
                    {snippet.description || snippet.content}
                  </span>
                </div>
                <div className="settings-list__actions">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('snippetsManager.edit')} ${snippet.trigger}`}
                    onClick={() => openEditModal(snippet)}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`${t('snippetsManager.delete')} ${snippet.trigger}`}
                    onClick={() => setPendingDelete(snippet)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </SettingsList>
        )}
      </SettingsSection>
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!isSaving && !open) closeModal();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('snippetsManager.editTitle') : t('snippetsManager.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('snippetsManager.subtitle')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              handleSave();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="snippet-trigger">
                  {t('snippetsManager.triggerLabel')}
                </FieldLabel>
                <Input
                  id="snippet-trigger"
                  value={form.trigger}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, trigger: event.target.value }))
                  }
                  placeholder={t('snippetsManager.triggerPlaceholder')}
                  className="font-mono"
                  disabled={isSaving}
                />
                <FieldDescription>{t('snippetsManager.triggerHint')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="snippet-content">
                  {t('snippetsManager.contentLabel')}
                </FieldLabel>
                <Textarea
                  id="snippet-content"
                  value={form.content}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, content: event.target.value }))
                  }
                  placeholder={t('snippetsManager.contentPlaceholder')}
                  rows={5}
                  disabled={isSaving}
                />
                <FieldDescription>{t('snippetsManager.contentHint')}</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="snippet-category">
                    {t('snippetsManager.categoryLabel')}
                  </FieldLabel>
                  <Input
                    id="snippet-category"
                    value={form.category}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, category: event.target.value }))
                    }
                    placeholder={t('snippetsManager.categoryPlaceholder')}
                    disabled={isSaving}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="snippet-description">
                    {t('snippetsManager.descriptionLabel')}
                  </FieldLabel>
                  <Input
                    id="snippet-description"
                    value={form.description}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, description: event.target.value }))
                    }
                    placeholder={t('snippetsManager.descriptionPlaceholder')}
                    disabled={isSaving}
                  />
                </Field>
              </div>
              {editingId && (
                <SettingsField label={t('snippetsManager.enabledLabel')} htmlFor="snippet-enabled">
                  <Switch
                    id="snippet-enabled"
                    checked={form.enabled}
                    disabled={isSaving}
                    onCheckedChange={(enabled) => setForm((previous) => ({ ...previous, enabled }))}
                  />
                </SettingsField>
              )}
            </FieldGroup>
            {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal} disabled={isSaving}>
                {t('snippetsManager.cancel')}
              </Button>
              <Button type="submit" disabled={!canSave || isSaving}>
                {isSaving ? t('snippetsManager.saving') : t('snippetsManager.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('snippetsManager.delete')}</DialogTitle>
            <DialogDescription>
              {t('snippetsManager.confirmDelete', { trigger: pendingDelete?.trigger ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t('snippetsManager.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) handleDelete(pendingDelete);
              }}
            >
              {t('snippetsManager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
