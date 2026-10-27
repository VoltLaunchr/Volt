import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ExternalLink, Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Input } from '@/shared/components/ui/input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { SettingsBody, SettingsPageHeader, SettingsSelect, SettingsStatus } from './SettingsChrome';
import { SettingsNote, SettingsRow, SettingsSection } from './SettingsPrimitives';
import { AiProfileSection } from '../../ai-profile';
import { QuickActionsSection } from '../../ai-quick-actions';
import {
  DEFAULT_LOCAL_BASE_URL,
  clearLocalConfig,
  loadLocalConfig,
  saveLocalConfig,
} from '../../plugins/builtin/ai-chat/lib/localProvider';

interface ProviderStatus {
  provider: string;
  hasKey: boolean;
}

interface ProviderMeta {
  id: string;
  label: string;
  logo: string;
  consoleUrl: string;
  defaultModel: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    logo: '/ai/openai-color.webp',
    consoleUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'GPT-5.5',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    logo: '/ai/claude-color.svg',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'Claude Opus 4.7',
  },
  {
    id: 'groq',
    label: 'Groq',
    logo: '/ai/groq.svg',
    consoleUrl: 'https://console.groq.com/keys',
    defaultModel: 'Llama 3.3 70B',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    logo: '/ai/huggingface-color.webp',
    consoleUrl:
      'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
    defaultModel: 'DeepSeek V4 Pro',
  },
];

function ProviderLogo({ logo, label }: { logo: string; label: string }) {
  const [errored, setErrored] = useState(false);
  if (errored)
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
        {label.slice(0, 2)}
      </span>
    );
  return (
    <img
      src={logo}
      alt=""
      className={`size-8 shrink-0 rounded-lg object-contain ${/\/(openai|groq)/.test(logo) ? 'dark:invert' : ''}`}
      onError={() => setErrored(true)}
    />
  );
}

function AddKeyModal({
  onClose,
  onSaved,
  initialProvider,
}: {
  onClose: () => void;
  onSaved: () => void;
  initialProvider?: string;
}) {
  const { t } = useTranslation('settings');
  const [provider, setProvider] = useState(initialProvider ?? PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [verifyError, setVerifyError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const busy = saving || verifyState === 'loading';
  const handleVerify = async () => {
    if (!apiKey.trim() || busy) return;
    setVerifyState('loading');
    setVerifyError('');
    try {
      await invoke('ai_set_global_key', { provider, key: apiKey.trim() });
      await invoke('ai_verify_key', { provider });
      setVerifyState('ok');
    } catch (error) {
      setVerifyState('error');
      setVerifyError(String(error));
    }
  };
  const handleSave = async () => {
    if (!apiKey.trim() || busy) return;
    setSaving(true);
    try {
      await invoke('ai_set_global_key', { provider, key: apiKey.trim() });
      onSaved();
    } catch (error) {
      setVerifyState('error');
      setVerifyError(String(error));
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={inputRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t('ai.modal.title')}</DialogTitle>
          <DialogDescription>
            {t('ai.modal.manageInConsole', { provider: meta.label })}
          </DialogDescription>
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
              <FieldLabel htmlFor="ai-provider">{t('ai.modal.provider')}</FieldLabel>
              <SettingsSelect
                id="ai-provider"
                label={t('ai.modal.provider')}
                value={provider}
                options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                onValueChange={(value) => {
                  setProvider(value);
                  setVerifyState('idle');
                  setVerifyError('');
                }}
                disabled={busy}
                className="w-full"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ai-api-key">{t('ai.modal.apiKey')}</FieldLabel>
              <div className="relative">
                <Input
                  id="ai-api-key"
                  ref={inputRef}
                  autoComplete="off"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  disabled={busy}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setVerifyState('idle');
                    setVerifyError('');
                  }}
                  placeholder={t('ai.modal.placeholder', { provider: meta.label })}
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  aria-label={showKey ? t('integrations.hideToken') : t('integrations.showToken')}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              <FieldDescription>
                <a
                  href={meta.consoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  {t('ai.modal.manageInConsole', { provider: meta.label })}
                  <ExternalLink className="size-3" />
                </a>
              </FieldDescription>
            </Field>
          </FieldGroup>
          {verifyState === 'ok' && (
            <SettingsStatus kind="success">{t('ai.modal.verified')}</SettingsStatus>
          )}
          {verifyState === 'error' && (
            <SettingsStatus kind="error">{verifyError || t('ai.modal.invalid')}</SettingsStatus>
          )}
          <DialogFooter className="flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleVerify()}
              disabled={!apiKey.trim() || busy}
            >
              {verifyState === 'loading' && <Loader2 className="animate-spin" />}
              {t('ai.modal.verify')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('ai.modal.cancel')}
            </Button>
            <Button type="submit" disabled={!apiKey.trim() || busy}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? t('ai.modal.saving') : t('ai.modal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LocalModelSection() {
  const { t } = useTranslation('settings');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LOCAL_BASE_URL);
  const [model, setModel] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const config = loadLocalConfig();
    if (config) {
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      setConfigured(true);
    }
  }, []);
  const canSave = !!baseUrl.trim() && !!model.trim();
  const handleSave = () => {
    if (!canSave) return;
    saveLocalConfig({ baseUrl: baseUrl.trim(), model: model.trim() });
    setConfigured(true);
    setSaved(true);
    globalThis.setTimeout(() => setSaved(false), 1500);
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <SettingsSection sectionId="ai.local" showDescription>
        <SettingsRow
          rowId="ai.local.baseUrl"
          htmlFor="ai-local-base-url"
          badge={
            configured ? (
              <Badge variant="secondary">
                <CheckCircle aria-hidden="true" />
                {t('ai.local.configured')}
              </Badge>
            ) : undefined
          }
        >
          <Input
            id="ai-local-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={DEFAULT_LOCAL_BASE_URL}
            spellCheck={false}
            className="w-72 font-mono"
          />
        </SettingsRow>
        <SettingsRow rowId="ai.local.model" htmlFor="ai-local-model">
          <Input
            id="ai-local-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={t('ai.local.modelPlaceholder')}
            spellCheck={false}
            className="w-72"
          />
        </SettingsRow>
        <SettingsRow rowId="ai.local.save">
          <div className="flex flex-wrap justify-end gap-2">
            {configured && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearLocalConfig();
                  setConfigured(false);
                  setModel('');
                  setBaseUrl(DEFAULT_LOCAL_BASE_URL);
                }}
              >
                {t('ai.local.remove')}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!canSave}>
              {saved && <CheckCircle aria-hidden="true" />}
              {saved ? t('ai.local.saved') : t('ai.local.save')}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </form>
  );
}

export function AiSettingsView() {
  const { t } = useTranslation('settings');
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatusError(false);
    try {
      const result = await invoke<ProviderStatus[]>('ai_get_providers_status');
      if (!Array.isArray(result)) throw new Error('Provider status unavailable');
      setStatuses(result);
    } catch {
      setStatusError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (provider: string) => {
      setDeleting(provider);
      setDeleteError(false);
      try {
        await invoke('ai_delete_global_key', { provider });
        await refresh();
      } catch {
        setDeleteError(true);
      } finally {
        setDeleting(null);
      }
    },
    [refresh]
  );

  const handleAdd = useCallback((providerId?: string) => {
    setSelectedProvider(providerId);
    setShowModal(true);
  }, []);

  const handleSaved = useCallback(async () => {
    setShowModal(false);
    await refresh();
  }, [refresh]);

  return (
    <div className="settings-page">
      <SettingsPageHeader category="ai" />
      <SettingsBody>
        {statusError && (
          <SettingsStatus
            kind="error"
            title={t('ai.statusErrorTitle')}
            action={
              <Button variant="outline" onClick={() => void refresh()}>
                {t('navigation.retry')}
              </Button>
            }
          >
            {t('ai.statusErrorDesc')}
          </SettingsStatus>
        )}
        {deleteError && <SettingsStatus kind="error">{t('ai.deleteError')}</SettingsStatus>}
        <SettingsSection
          sectionId="ai.providers"
          showDescription
          action={
            <Button size="sm" variant="outline" onClick={() => handleAdd()}>
              <Plus size={14} aria-hidden="true" />
              {t('ai.addKey')}
            </Button>
          }
        >
          {loading ? (
            <SettingsNote>
              <span role="status" className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t('ai.loading')}
              </span>
            </SettingsNote>
          ) : statusError ? (
            <SettingsNote>{t('ai.statusUnavailable')}</SettingsNote>
          ) : (
            PROVIDERS.map((meta) => {
              const configured = statuses.some(
                (status) => status.provider === meta.id && status.hasKey
              );
              return (
                <SettingsRow
                  key={meta.id}
                  rowId={`ai.providers.${meta.id}`}
                  icon={<ProviderLogo logo={meta.logo} label={meta.label} />}
                  description={
                    configured
                      ? t('ai.defaultModel', { model: meta.defaultModel })
                      : t('ai.notConfigured', { provider: meta.label })
                  }
                  badge={
                    configured ? (
                      <Badge variant="secondary">
                        <CheckCircle aria-hidden="true" />
                        {t('ai.connected')}
                      </Badge>
                    ) : undefined
                  }
                >
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => handleAdd(meta.id)}>
                      {configured ? t('ai.replace') : t('ai.addKey')}
                    </Button>
                    {configured && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={t('ai.deleteProvider', { provider: meta.label })}
                        disabled={deleting === meta.id}
                        onClick={() => void handleDelete(meta.id)}
                      >
                        {deleting === meta.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      </Button>
                    )}
                  </div>
                </SettingsRow>
              );
            })
          )}
        </SettingsSection>
        <LocalModelSection />
        <AiProfileSection />
        <QuickActionsSection />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('ai.infoBefore')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">VoltAPI.ai.ask()</code>
          {t('ai.infoMiddle')} <code className="rounded bg-muted px-1 py-0.5 font-mono">ai</code>{' '}
          {t('ai.infoAfter')}
        </p>
      </SettingsBody>
      {showModal && (
        <AddKeyModal
          initialProvider={selectedProvider}
          onClose={() => setShowModal(false)}
          onSaved={() => void handleSaved()}
        />
      )}
    </div>
  );
}
