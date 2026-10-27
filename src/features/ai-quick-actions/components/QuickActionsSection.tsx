import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, CheckCircle, Edit3, X } from 'lucide-react';
import { HotkeyCapture } from '../../../shared/components/ui/HotkeyCapture';
import { useQuickActions } from '../hooks/useQuickActions';
import { PLACEHOLDER_DOCS } from '../placeholders';
import { QuickActionIcon, QUICK_ACTION_ICONS } from '../icons';
import type { AiQuickAction } from '../types';

import { Button } from '@/shared/components/ui/button';
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
import { SettingsStatus } from '../../settings/components/SettingsChrome';
import {
  SettingsList,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from '../../settings/components/SettingsPrimitives';

function HotkeyChip({
  value,
  bindError,
  onChange,
  onClear,
}: {
  value: string | null | undefined;
  bindError: string | null;
  onChange: (hotkey: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('settings');
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="flex items-center gap-1">
        <HotkeyCapture
          value={value ?? ''}
          onChange={(hotkey) => {
            onChange(hotkey);
            setEditing(false);
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('ai.quickActions.cancel')}
          onClick={() => setEditing(false)}
        >
          <X />
        </Button>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setEditing(true)}
        title={bindError ?? t('ai.quickActions.clickToChange')}
        className={bindError ? 'text-destructive' : undefined}
      >
        {value ? <kbd className="font-mono text-xs">{value}</kbd> : t('ai.quickActions.bindHotkey')}
      </Button>
      {value && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('ai.quickActions.removeHotkey')}
          onClick={onClear}
        >
          <X />
        </Button>
      )}
      {bindError && (
        <span className="text-xs text-destructive" title={bindError}>
          {t('ai.quickActions.failed')}
        </span>
      )}
    </div>
  );
}

function EditPromptModal({
  action,
  onClose,
  onSave,
}: {
  action: AiQuickAction;
  onClose: () => void;
  onSave: (patch: Partial<AiQuickAction>) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [label, setLabel] = useState(action.label);
  const [system, setSystem] = useState(action.systemPrompt);
  const [icon, setIcon] = useState<string | null>(action.icon ?? 'sparkles');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const handleSave = async () => {
    if (!label.trim() || !system.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ label: label.trim(), systemPrompt: system.trim(), icon });
      onClose();
    } catch (error) {
      setSaveError(String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t('ai.quickActions.modal.title')}</DialogTitle>
          <DialogDescription>{t('ai.quickActions.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>{t('ai.quickActions.modal.icon')}</FieldLabel>
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {Object.keys(QUICK_ACTION_ICONS).map((key) => (
                  <Button
                    key={key}
                    size="icon-sm"
                    variant={icon === key ? 'secondary' : 'ghost'}
                    type="button"
                    aria-label={key}
                    aria-pressed={icon === key}
                    onClick={() => setIcon(key)}
                    disabled={saving}
                  >
                    <QuickActionIcon name={key} size={16} />
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="quick-action-label">
                {t('ai.quickActions.modal.label')}
              </FieldLabel>
              <Input
                id="quick-action-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={saving}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="quick-action-system">
                {t('ai.quickActions.modal.systemPrompt')}
              </FieldLabel>
              <Textarea
                id="quick-action-system"
                value={system}
                onChange={(event) => setSystem(event.target.value)}
                rows={5}
                disabled={saving}
              />
              <FieldDescription>{t('ai.quickActions.modal.placeholdersIntro')}</FieldDescription>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {PLACEHOLDER_DOCS.map((placeholder) => (
                  <li key={placeholder.token} className="flex flex-wrap gap-x-2">
                    <code className="font-mono text-foreground">{placeholder.token}</code>
                    <span>{placeholder.description}</span>
                  </li>
                ))}
              </ul>
            </Field>
          </FieldGroup>
          {saveError && <SettingsStatus kind="error">{saveError}</SettingsStatus>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('ai.quickActions.modal.cancel')}
            </Button>
            <Button type="submit" disabled={!label.trim() || !system.trim() || saving}>
              {saving ? t('ai.quickActions.modal.saving') : t('ai.quickActions.modal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuickActionsSection() {
  const { t } = useTranslation('settings');
  const { actions, loading, report, error, updateAction, createAction, deleteAction } =
    useQuickActions();
  const [editing, setEditing] = useState<AiQuickAction | null>(null);

  const handleAddCustom = useCallback(async () => {
    const draft: AiQuickAction = {
      id: `custom-${Date.now()}`,
      label: t('ai.quickActions.newAction'),
      systemPrompt: t('ai.quickActions.newPrompt'),
      hotkey: null,
      enabled: true,
      provider: null,
      icon: null,
    };
    await createAction(draft);
    // Open the editor for the freshly created action
    setEditing(draft);
  }, [createAction, t]);

  return (
    <>
      <SettingsSection sectionId="ai.quickActions" showDescription>
        <SettingsRow rowId="ai.quickActions.add">
          <Button size="sm" variant="secondary" onClick={() => void handleAddCustom()}>
            <Plus size={14} aria-hidden="true" />
            {t('ai.quickActions.add')}
          </Button>
        </SettingsRow>
        {loading ? (
          <SettingsNote>
            <span role="status">{t('ai.quickActions.loading')}</span>
          </SettingsNote>
        ) : actions.length === 0 ? (
          <SettingsNote>{t('ai.quickActions.empty')}</SettingsNote>
        ) : (
          <SettingsList label={t('ai.quickActions.title')}>
            {actions.map((action) => {
              const bindStatus = report[action.id];
              const bindError = bindStatus && bindStatus !== 'ok' ? bindStatus : null;
              return (
                <div
                  key={action.id}
                  role="listitem"
                  className="settings-list__item settings-list__item--static flex-wrap"
                >
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
                    aria-hidden
                  >
                    <QuickActionIcon name={action.icon} size={16} />
                  </div>
                  <div className="settings-list__text">
                    <span className="settings-list__title">{action.label}</span>
                    <span className="settings-list__meta" title={action.systemPrompt}>
                      {action.systemPrompt}
                    </span>
                  </div>
                  <HotkeyChip
                    value={action.hotkey}
                    bindError={bindError}
                    onChange={(hotkey) => void updateAction(action.id, { hotkey })}
                    onClear={() => void updateAction(action.id, { hotkey: null })}
                  />
                  {bindStatus === 'ok' && (
                    <CheckCircle className="size-3.5 text-muted-foreground" />
                  )}
                  <Switch
                    checked={action.enabled}
                    onCheckedChange={(enabled) => void updateAction(action.id, { enabled })}
                    aria-label={`${action.enabled ? t('ai.quickActions.disable') : t('ai.quickActions.enable')} ${action.label}`}
                  />
                  <div className="settings-list__actions">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${t('ai.quickActions.edit')} ${action.label}`}
                      onClick={() => setEditing(action)}
                    >
                      <Edit3 />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`${t('ai.quickActions.delete')} ${action.label}`}
                      onClick={() => void deleteAction(action.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </SettingsList>
        )}
      </SettingsSection>
      {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
      {editing && (
        <EditPromptModal
          action={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => updateAction(editing.id, patch)}
        />
      )}
    </>
  );
}
