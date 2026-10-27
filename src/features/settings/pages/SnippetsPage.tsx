import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Switch } from '@/shared/components/ui/switch';
import { Field, FieldDescription, FieldLabel } from '@/shared/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import { SnippetsManagerPanel } from '../components/SnippetsManagerPanel';
import { SettingsBody, SettingsPageHeader, SettingsStatus } from '../components/SettingsChrome';
import {
  SettingsGate,
  SettingsList,
  SettingsListItem,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from '../components/SettingsPrimitives';
import { addClipboardAppExclusion, normalizeClipboardAppName } from '../clipboardExclusions';
import type { SnippetExpansionSettings } from '../types/settings.types';

interface SnippetsPageProps {
  pluginState: SettingsPluginState;
  expansion: SnippetExpansionSettings;
  onExpansionChange: (patch: Partial<SnippetExpansionSettings>) => void;
}

/**
 * Snippets: the in-app library (`;` in the search bar, tied to the plugin switch) and the
 * separate system-wide expansion, which keeps working whatever the plugin switch says.
 */
export function SnippetsPage({ pluginState, expansion, onExpansionChange }: SnippetsPageProps) {
  const { t } = useTranslation('settings');
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const toggleExpansion = async (enabled: boolean) => {
    setError(null);
    try {
      await invoke<void>('set_snippet_expansion_enabled', { enabled });
      onExpansionChange({ enabled });
    } catch (toggleError) {
      logger.error('Failed to toggle global snippet expansion:', toggleError);
      setError(extractErrorMessage(toggleError));
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDraft('');
  };

  return (
    <div className="settings-page">
      <SettingsPageHeader category="snippets" />
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) setDialogOpen(true);
          else closeDialog();
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('snippetExpansion.addApp')}</DialogTitle>
            <DialogDescription>{t('snippetExpansion.excludedAppsDesc')}</DialogDescription>
          </DialogHeader>
          <form
            id="snippet-exclusion-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!normalizeClipboardAppName(draft)) return;
              onExpansionChange({
                excludedApps: addClipboardAppExclusion(expansion.excludedApps, draft),
              });
              closeDialog();
            }}
          >
            <Field>
              <FieldLabel htmlFor="snippet-exclusion-name">
                {t('clipboard.appExecutable')}
              </FieldLabel>
              <Input
                id="snippet-exclusion-name"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="1password"
                maxLength={260}
                autoComplete="off"
                aria-describedby="snippet-exclusion-hint"
              />
              <FieldDescription id="snippet-exclusion-hint" className="text-xs">
                {t('clipboard.appExecutableHint')}
              </FieldDescription>
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('navigation.cancel')}
            </Button>
            <Button
              type="submit"
              form="snippet-exclusion-form"
              disabled={!normalizeClipboardAppName(draft)}
            >
              {t('snippetExpansion.addApp')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SettingsBody>
        <SettingsPluginSection page="snippets" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SnippetsManagerPanel />
        </SettingsGate>
        <SettingsSection sectionId="snippets.global" showDescription>
          {error && (
            <div className="p-2.5">
              <SettingsStatus kind="error">{error}</SettingsStatus>
            </div>
          )}
          <SettingsRow rowId="snippets.global.enabled">
            <Switch
              checked={expansion.enabled}
              onCheckedChange={(enabled) => void toggleExpansion(enabled)}
            />
          </SettingsRow>
          <SettingsRow rowId="snippets.global.maxTriggerLen">
            <Input
              type="number"
              min={4}
              max={256}
              step={1}
              className="w-24"
              value={expansion.maxTriggerLen}
              onChange={(event) =>
                onExpansionChange({ maxTriggerLen: Math.max(4, Number(event.target.value)) })
              }
            />
          </SettingsRow>
          <SettingsRow rowId="snippets.global.excludedApps">
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus size={14} aria-hidden="true" />
              {t('snippetExpansion.addApp')}
            </Button>
          </SettingsRow>
          <SettingsList
            label={t('snippetExpansion.excludedApps')}
            empty={t('snippetExpansion.noExcludedApps')}
          >
            {expansion.excludedApps.map((app) => (
              <SettingsListItem
                key={app}
                label={app}
                removeLabel={t('clipboard.removeApp', { app })}
                onRemove={() =>
                  onExpansionChange({
                    excludedApps: expansion.excludedApps.filter((candidate) => candidate !== app),
                  })
                }
              />
            ))}
          </SettingsList>
        </SettingsSection>
      </SettingsBody>
    </div>
  );
}
