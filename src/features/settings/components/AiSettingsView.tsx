import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ExternalLink, Plus, Trash2, CheckCircle, XCircle, Loader, Cpu } from 'lucide-react';
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

/**
 * Provider logos that ship as a black-on-transparent asset. We render on a
 * dark canvas, so we flip these to white via a CSS filter. Single source of
 * truth — keep in sync with the matching constants in AiChatView/QuickAiView.
 */
const MONOCHROME_LOGO_RE = /\/(openai|groq)/;

function ProviderLogo({ logo, label }: { logo: string; label: string }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    const initials = label.slice(0, 2).toUpperCase();
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-ink)',
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
    );
  }

  const isMono = MONOCHROME_LOGO_RE.test(logo);
  return (
    <img
      src={logo}
      alt={label}
      width={32}
      height={32}
      style={{
        borderRadius: 8,
        flexShrink: 0,
        objectFit: 'contain',
        filter: isMono ? 'invert(1)' : undefined,
      }}
      onError={() => setErrored(true)}
    />
  );
}

type VerifyState = 'idle' | 'loading' | 'ok' | 'error';

interface AddKeyModalProps {
  onClose: () => void;
  onSaved: () => void;
  initialProvider?: string;
}

function AddKeyModal({ onClose, onSaved, initialProvider }: AddKeyModalProps) {
  const { t } = useTranslation('settings');
  const [provider, setProvider] = useState(initialProvider ?? PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [verifyError, setVerifyError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  const handleVerify = useCallback(async () => {
    if (!apiKey.trim()) return;
    setVerifyState('loading');
    setVerifyError('');
    try {
      await invoke('ai_set_global_key', { provider, key: apiKey.trim() });
      await invoke('ai_verify_key', { provider });
      setVerifyState('ok');
    } catch (err) {
      setVerifyState('error');
      setVerifyError(String(err));
    }
  }, [provider, apiKey]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await invoke('ai_set_global_key', { provider, key: apiKey.trim() });
      onSaved();
    } catch (err) {
      setSaving(false);
      setVerifyState('error');
      setVerifyError(String(err));
    }
  }, [provider, apiKey, onSaved]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && apiKey.trim() && !saving) void handleSave();
    },
    [onClose, apiKey, saving, handleSave]
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-canvas)',
          borderRadius: 12,
          border: '1px solid var(--color-hairline)',
          padding: '24px',
          width: 420,
          maxWidth: 'calc(100vw - 48px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 600, color: 'var(--color-ink)' }}>
          {t('ai.modal.title')}
        </h2>

        {/* Provider selector */}
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--color-mute)', fontWeight: 500 }}>
          {t('ai.modal.provider')}
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProvider(p.id); setVerifyState('idle'); setVerifyError(''); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 12px',
                borderRadius: 8,
                border: `1.5px solid ${provider === p.id ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
                background:
                  provider === p.id
                    ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                    : 'var(--color-surface)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-ink)',
                transition: 'border-color 0.15s',
              }}
            >
              <ProviderLogo logo={p.logo} label={p.label} />
              {p.label}
            </button>
          ))}
        </div>

        {/* API Key input */}
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--color-mute)', fontWeight: 500 }}>
          {t('ai.modal.apiKey')}
        </label>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <input
            ref={inputRef}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setVerifyState('idle'); setVerifyError(''); }}
            placeholder={t('ai.modal.placeholder', { provider: meta.label })}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '9px 40px 9px 12px',
              borderRadius: 8,
              border: '1.5px solid var(--color-hairline)',
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              fontSize: 13,
              fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-mute)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {/* Console link */}
        <a
          href={meta.consoleUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            color: 'var(--color-accent)',
            textDecoration: 'none',
            marginBottom: 20,
          }}
        >
          {t('ai.modal.manageInConsole', { provider: meta.label })}
          <ExternalLink size={11} />
        </a>

        {/* Verify status */}
        {verifyState === 'ok' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 13, color: '#22c55e' }}>
            <CheckCircle size={14} /> {t('ai.modal.verified')}
          </div>
        )}
        {verifyState === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 13, color: 'var(--color-accent-red)', flexWrap: 'wrap' }}>
            <XCircle size={14} /> {verifyError || t('ai.modal.invalid')}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            onClick={() => void handleVerify()}
            disabled={!apiKey.trim() || verifyState === 'loading'}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1.5px solid var(--color-hairline)',
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              fontSize: 13,
              cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
              opacity: apiKey.trim() ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {verifyState === 'loading' ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {t('ai.modal.verify')}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1.5px solid var(--color-hairline)',
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t('ai.modal.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!apiKey.trim() || saving}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
              opacity: apiKey.trim() ? 1 : 0.5,
            }}
          >
            {saving ? t('ai.modal.saving') : t('ai.modal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Local model provider (Ollama / LM Studio). No API key — the endpoint + model id
 * persist renderer-side via `localProvider` and are forwarded per-request through
 * the AI proxy (Pari B). Saving fires a cross-window `storage` event so an open
 * chat window picks up the change immediately.
 */
function LocalModelSection() {
  const { t } = useTranslation('settings');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LOCAL_BASE_URL);
  const [model, setModel] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadLocalConfig();
    if (cfg) {
      setBaseUrl(cfg.baseUrl);
      setModel(cfg.model);
      setConfigured(true);
    }
  }, []);

  const canSave = baseUrl.trim().length > 0 && model.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    saveLocalConfig({ baseUrl: baseUrl.trim(), model: model.trim() });
    setConfigured(true);
    setSaved(true);
    globalThis.setTimeout(() => setSaved(false), 1500);
  }, [baseUrl, model, canSave]);

  const handleRemove = useCallback(() => {
    clearLocalConfig();
    setConfigured(false);
    setModel('');
    setBaseUrl(DEFAULT_LOCAL_BASE_URL);
  }, []);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1.5px solid var(--color-hairline)',
    background: 'var(--color-canvas)',
    color: 'var(--color-ink)',
    fontSize: 13,
    fontFamily: 'monospace',
    outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 4,
    fontSize: 12,
    color: 'var(--color-mute)',
    fontWeight: 500,
  };

  return (
    <div
      style={{
        marginTop: 16,
        background: 'var(--color-surface)',
        borderRadius: 12,
        border: '1px solid var(--color-hairline)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-hairline)',
        }}
      >
        <Cpu size={16} style={{ color: 'var(--color-accent)' }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>
          {t('ai.local.title')}
        </span>
        {configured && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: '#22c55e',
              background: 'rgba(34,197,94,0.1)',
              padding: '3px 8px',
              borderRadius: 20,
            }}
          >
            <CheckCircle size={11} />
            {t('ai.local.configured')}
          </span>
        )}
      </div>

      <div style={{ padding: '16px' }}>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-mute)', lineHeight: 1.6 }}>
          {t('ai.local.description')}
        </p>

        <label style={labelStyle}>{t('ai.local.baseUrl')}</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={DEFAULT_LOCAL_BASE_URL}
          spellCheck={false}
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        <label style={labelStyle}>{t('ai.local.model')}</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={t('ai.local.modelPlaceholder')}
          spellCheck={false}
          style={inputStyle}
        />

        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-mute)', lineHeight: 1.5 }}>
          {t('ai.local.hint')}
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          {configured && (
            <button
              onClick={handleRemove}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1.5px solid var(--color-hairline)',
                background: 'none',
                color: 'var(--color-accent-red)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('ai.local.remove')}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: canSave ? 'pointer' : 'not-allowed',
              opacity: canSave ? 1 : 0.5,
            }}
          >
            {saved ? <CheckCircle size={13} /> : null}
            {saved ? t('ai.local.saved') : t('ai.local.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiSettingsView() {
  const { t } = useTranslation('settings');
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<ProviderStatus[]>('ai_get_providers_status');
      setStatuses(result);
    } catch (_err) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (provider: string) => {
    setDeleting(provider);
    try {
      await invoke('ai_delete_global_key', { provider });
      await refresh();
    } catch (_err) {
      // ignore
    } finally {
      setDeleting(null);
    }
  }, [refresh]);

  const handleAdd = useCallback((providerId?: string) => {
    setSelectedProvider(providerId);
    setShowModal(true);
  }, []);

  const handleSaved = useCallback(async () => {
    setShowModal(false);
    await refresh();
  }, [refresh]);

  const configuredProviders = statuses.filter((s) => s.hasKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
          padding: '0 24px',
          borderBottom: '1px solid var(--color-hairline)',
          flexShrink: 0,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>
          {t('ai.title')}
        </h2>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--color-mute)', lineHeight: 1.6 }}>
          {t('ai.description')}
        </p>

        {/* API Keys section */}
        <div
          style={{
            background: 'var(--color-surface)',
            borderRadius: 12,
            border: '1px solid var(--color-hairline)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: configuredProviders.length > 0 ? '1px solid var(--color-hairline)' : 'none',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>{t('ai.apiKeys')}</span>
            <button
              onClick={() => handleAdd()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                borderRadius: 7,
                border: '1.5px solid var(--color-hairline)',
                background: 'var(--color-canvas)',
                color: 'var(--color-ink)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Plus size={13} />
              {t('ai.add')}
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-mute)', fontSize: 13 }}>
              {t('ai.loading')}
            </div>
          ) : configuredProviders.length === 0 ? (
            <div
              style={{
                padding: '40px 24px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--color-mute)', marginBottom: 16 }}>{t('ai.noKeys')}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAdd(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1.5px solid var(--color-hairline)',
                      background: 'var(--color-canvas)',
                      color: 'var(--color-ink)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    <ProviderLogo logo={p.logo} label={p.label} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {configuredProviders.map((status, idx) => {
                const meta = PROVIDERS.find((p) => p.id === status.provider);
                if (!meta) return null;
                return (
                  <div
                    key={status.provider}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderBottom: idx < configuredProviders.length - 1 ? '1px solid var(--color-hairline)' : 'none',
                    }}
                  >
                    <ProviderLogo logo={meta.logo} label={meta.label} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)' }}>{meta.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-mute)' }}>
                        {t('ai.defaultModel', { model: meta.defaultModel })}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 12,
                        color: '#22c55e',
                        background: 'rgba(34,197,94,0.1)',
                        padding: '3px 8px',
                        borderRadius: 20,
                      }}
                    >
                      <CheckCircle size={11} />
                      {t('ai.connected')}
                    </div>
                    <button
                      onClick={() => handleAdd(meta.id)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 7,
                        border: '1.5px solid var(--color-hairline)',
                        background: 'none',
                        color: 'var(--color-mute)',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {t('ai.replace')}
                    </button>
                    <button
                      onClick={() => void handleDelete(meta.id)}
                      disabled={deleting === meta.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: 6,
                        borderRadius: 7,
                        border: '1.5px solid var(--color-hairline)',
                        background: 'none',
                        color: 'var(--color-accent-red)',
                        cursor: 'pointer',
                        opacity: deleting === meta.id ? 0.5 : 1,
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}

              {/* Show unconfigured providers as quick-add shortcuts */}
              {statuses.filter((s) => !s.hasKey).map((status) => {
                const meta = PROVIDERS.find((p) => p.id === status.provider);
                if (!meta) return null;
                return (
                  <div
                    key={status.provider}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderTop: '1px solid var(--color-hairline)',
                      opacity: 0.6,
                    }}
                  >
                    <ProviderLogo logo={meta.logo} label={meta.label} />
                    <div style={{ flex: 1, fontSize: 13, color: 'var(--color-mute)' }}>
                      {t('ai.notConfigured', { provider: meta.label })}
                    </div>
                    <button
                      onClick={() => handleAdd(meta.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 10px',
                        borderRadius: 7,
                        border: '1.5px solid var(--color-hairline)',
                        background: 'none',
                        color: 'var(--color-ink)',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <Plus size={12} /> {t('ai.addKey')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Local model provider (Ollama / LM Studio) — no API key */}
        <LocalModelSection />

        {/* AI Profile (personalization prefix for AI Chat) */}
        <AiProfileSection />

        {/* Quick Actions */}
        <QuickActionsSection />


        {/* Info callout */}
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            borderRadius: 10,
            border: '1px solid var(--color-hairline)',
            fontSize: 12,
            color: 'var(--color-mute)',
            lineHeight: 1.6,
          }}
        >
          {t('ai.infoBefore')}{' '}
          <code style={{ fontFamily: 'monospace', background: 'var(--color-surface)', padding: '1px 4px', borderRadius: 4 }}>VoltAPI.ai.ask()</code>
          {t('ai.infoMiddle')}{' '}
          <code style={{ fontFamily: 'monospace', background: 'var(--color-surface)', padding: '1px 4px', borderRadius: 4 }}>ai</code>{' '}
          {t('ai.infoAfter')}
        </div>
      </div>

      {showModal && (
        <AddKeyModal
          onClose={() => setShowModal(false)}
          onSaved={() => void handleSaved()}
          initialProvider={selectedProvider}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
