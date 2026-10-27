import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Switch } from '@/shared/components/ui/switch';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import {
  SettingsBody,
  SettingsPageHeader,
  SettingsSelect,
  SettingsStatus,
} from '../components/SettingsChrome';
import { SettingsList, SettingsRow, SettingsSection } from '../components/SettingsPrimitives';
import { POP_TO_ROOT_OPTIONS } from '../behavior/popToRoot';
import type { FallbackCommand, FallbackKind, LauncherSettings } from '../types/settings.types';

type EditableFallbackKind = Extract<FallbackKind, 'webSearch' | 'url'>;
type FallbackDraft = Pick<FallbackCommand, 'label' | 'target' | 'icon' | 'enabled'> & {
  kind: EditableFallbackKind;
};

const EMPTY_DRAFT: FallbackDraft = {
  label: '',
  target: '',
  icon: 'globe',
  kind: 'webSearch',
  enabled: true,
};

const sortCommands = (commands: readonly FallbackCommand[]): FallbackCommand[] =>
  [...commands].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

interface LauncherPageProps {
  launcher: LauncherSettings;
  onLauncherChange: (patch: Partial<LauncherSettings>) => void;
  commands: readonly FallbackCommand[];
  onCommandsChange: (commands: FallbackCommand[]) => void;
}

type ClearTarget = 'launches' | 'files';

/** Fallback actions (what to offer when nothing matches) and the history Volt learns from. */
export function LauncherPage({
  launcher,
  onLauncherChange,
  commands,
  onCommandsChange,
}: LauncherPageProps) {
  const { t } = useTranslation('settings');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FallbackDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [clearStatus, setClearStatus] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [clearing, setClearing] = useState<ClearTarget | null>(null);

  // The shell fallback is built in and cannot be edited, reordered or removed.
  const editable = sortCommands(commands).filter((command) => command.kind !== 'shell');

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  };

  const beginAdd = () => {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setEditingId('new');
  };

  const beginEdit = (command: FallbackCommand) => {
    if (command.kind === 'shell') return;
    setDraft({
      label: command.label,
      target: command.target,
      icon: command.icon ?? '',
      kind: command.kind,
      enabled: command.enabled,
    });
    setFormError(null);
    setEditingId(command.id);
  };

  const saveDraft = () => {
    const label = draft.label.trim();
    const target = draft.target.trim();
    if (!label || !target) {
      setFormError(t('fallbacks.validation.required'));
      return;
    }
    try {
      const parsed = new URL(
        target.replaceAll('{query}', 'query').replaceAll('{rawQuery}', 'query')
      );
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Unsupported fallback protocol');
      }
    } catch {
      setFormError(t('fallbacks.validation.invalidUrl'));
      return;
    }

    const isNew = editingId === 'new';
    const next: FallbackCommand = {
      ...draft,
      id: isNew
        ? `fallback-custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : (editingId ?? ''),
      label,
      target,
      icon: draft.icon?.trim() || undefined,
      order: isNew
        ? commands.reduce((max, command) => Math.max(max, command.order), -1) + 1
        : (commands.find((command) => command.id === editingId)?.order ?? 0),
    };
    onCommandsChange(
      isNew
        ? [...commands, next]
        : commands.map((command) => (command.id === editingId ? next : command))
    );
    closeEditor();
  };

  const toggle = (id: string, enabled: boolean) =>
    onCommandsChange(
      commands.map((command) => (command.id === id ? { ...command, enabled } : command))
    );

  const move = (id: string, direction: -1 | 1) => {
    const ordered = sortCommands(commands);
    const from = ordered.findIndex((command) => command.id === id);
    if (from < 0) return;
    let to = from + direction;
    while (to >= 0 && to < ordered.length && ordered[to].kind === 'shell') to += direction;
    if (to < 0 || to >= ordered.length) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    onCommandsChange(ordered.map((command, order) => ({ ...command, order })));
  };

  const remove = (command: FallbackCommand) => {
    if (!window.confirm(t('fallbacks.confirmDelete', { label: command.label }))) return;
    onCommandsChange(
      sortCommands(commands)
        .filter((candidate) => candidate.id !== command.id)
        .map((candidate, order) => ({ ...candidate, order }))
    );
    if (editingId === command.id) closeEditor();
  };

  const clear = async (target: ClearTarget) => {
    const confirmKey = target === 'launches' ? 'launcher.confirmLaunches' : 'launcher.confirmFiles';
    if (!window.confirm(t(confirmKey))) return;
    setClearing(target);
    setClearStatus(null);
    try {
      await invoke<void>(target === 'launches' ? 'clear_launch_history' : 'clear_file_history');
      setClearStatus({ kind: 'success', message: t('launcher.cleared') });
    } catch (error) {
      logger.error(`Failed to clear ${target} history:`, error);
      setClearStatus({
        kind: 'error',
        message: `${t('launcher.clearFailed')} ${extractErrorMessage(error)}`,
      });
    } finally {
      setClearing(null);
    }
  };

  return (
    <div className="settings-page">
      <SettingsPageHeader category="launcher" />
      <SettingsBody>
        <SettingsSection sectionId="launcher.root" showDescription>
          <SettingsRow rowId="launcher.root.popToRoot">
            <SettingsSelect
              label={t('launcher.popToRoot')}
              value={launcher.popToRoot}
              options={POP_TO_ROOT_OPTIONS.map((value) => ({
                value,
                label: t(`launcher.popToRootOptions.${value}`),
              }))}
              onValueChange={(popToRoot) => onLauncherChange({ popToRoot })}
            />
          </SettingsRow>
          <SettingsRow rowId="launcher.root.includeFiles">
            <Switch
              checked={launcher.includeFilesInRootSearch}
              onCheckedChange={(includeFilesInRootSearch) =>
                onLauncherChange({ includeFilesInRootSearch })
              }
            />
          </SettingsRow>
          <SettingsRow rowId="launcher.root.includeGames">
            <Switch
              checked={launcher.includeGamesInRootSearch}
              onCheckedChange={(includeGamesInRootSearch) =>
                onLauncherChange({ includeGamesInRootSearch })
              }
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection sectionId="launcher.fallbacks" showDescription>
          <SettingsRow rowId="launcher.fallbacks.list">
            <Button variant="secondary" size="sm" onClick={beginAdd} disabled={editingId !== null}>
              <Plus size={14} aria-hidden="true" />
              {t('fallbacks.add')}
            </Button>
          </SettingsRow>
          <SettingsList label={t('fallbacks.listTitle')} empty={t('fallbacks.empty')}>
            {editable.length > 0
              ? editable.map((command, index) => (
                  <div
                    key={command.id}
                    role="listitem"
                    className="settings-list__item settings-list__item--static"
                  >
                    <Globe
                      size={16}
                      className="shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="settings-list__text">
                      <span className="settings-list__title">
                        {command.label}{' '}
                        <span className="text-[10px] text-muted-foreground">
                          · {t(`fallbacks.kinds.${command.kind}`)}
                        </span>
                      </span>
                      <span className="settings-list__meta" title={command.target}>
                        {command.target}
                      </span>
                    </div>
                    <Switch
                      aria-label={command.label}
                      checked={command.enabled}
                      onCheckedChange={(checked) => toggle(command.id, checked)}
                    />
                    <div className="settings-list__actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(command.id, -1)}
                        disabled={index === 0}
                        aria-label={t('fallbacks.moveUp', { label: command.label })}
                        title={t('fallbacks.moveUp', { label: command.label })}
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(command.id, 1)}
                        disabled={index === editable.length - 1}
                        aria-label={t('fallbacks.moveDown', { label: command.label })}
                        title={t('fallbacks.moveDown', { label: command.label })}
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => beginEdit(command)}
                        disabled={editingId !== null}
                        aria-label={t('fallbacks.edit', { label: command.label })}
                        title={t('fallbacks.edit', { label: command.label })}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        onClick={() => remove(command)}
                        disabled={editingId !== null}
                        aria-label={t('fallbacks.delete', { label: command.label })}
                        title={t('fallbacks.delete', { label: command.label })}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))
              : null}
          </SettingsList>
          {editingId !== null && (
            <form
              className="settings-inline-form"
              aria-labelledby="fallback-editor-title"
              onSubmit={(event) => {
                event.preventDefault();
                saveDraft();
              }}
            >
              <h3 id="fallback-editor-title" className="m-0 text-[13px] font-medium">
                {editingId === 'new'
                  ? t('fallbacks.editor.addTitle')
                  : t('fallbacks.editor.editTitle')}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-medium">
                  {t('fallbacks.editor.label')}
                  <Input
                    type="text"
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, label: event.target.value }))
                    }
                    placeholder={t('fallbacks.editor.labelPlaceholder')}
                    autoFocus
                  />
                </label>
                <div className="flex flex-col gap-1.5 text-xs font-medium">
                  <span>{t('fallbacks.editor.kind')}</span>
                  <SettingsSelect
                    label={t('fallbacks.editor.kind')}
                    value={draft.kind}
                    onValueChange={(kind) => setDraft((current) => ({ ...current, kind }))}
                    options={[
                      { value: 'webSearch', label: t('fallbacks.kinds.webSearch') },
                      { value: 'url', label: t('fallbacks.kinds.url') },
                    ]}
                  />
                </div>
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                {t('fallbacks.editor.target')}
                <Input
                  type="url"
                  value={draft.target}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, target: event.target.value }))
                  }
                  placeholder={t('fallbacks.editor.targetPlaceholder')}
                  aria-describedby="fallback-target-help"
                />
                <span id="fallback-target-help" className="font-normal text-muted-foreground">
                  {t('fallbacks.editor.targetHelp')}
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                {t('fallbacks.editor.icon')}
                <Input
                  type="text"
                  value={draft.icon ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, icon: event.target.value }))
                  }
                  placeholder={t('fallbacks.editor.iconPlaceholder')}
                />
              </label>
              {formError && (
                <p role="alert" className="m-0 text-xs text-destructive">
                  {formError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={closeEditor}>
                  {t('fallbacks.editor.cancel')}
                </Button>
                <Button type="submit" size="sm">
                  {t('fallbacks.editor.save')}
                </Button>
              </div>
            </form>
          )}
        </SettingsSection>

        <SettingsSection sectionId="launcher.history" showDescription>
          <SettingsRow rowId="launcher.history.launches">
            <Button
              variant="secondary"
              size="sm"
              disabled={clearing !== null}
              onClick={() => void clear('launches')}
            >
              {t('launcher.clear')}
            </Button>
          </SettingsRow>
          <SettingsRow rowId="launcher.history.files">
            <Button
              variant="secondary"
              size="sm"
              disabled={clearing !== null}
              onClick={() => void clear('files')}
            >
              {t('launcher.clear')}
            </Button>
          </SettingsRow>
          {clearStatus && (
            <div className="p-2.5">
              <SettingsStatus kind={clearStatus.kind}>{clearStatus.message}</SettingsStatus>
            </div>
          )}
        </SettingsSection>
      </SettingsBody>
    </div>
  );
}
