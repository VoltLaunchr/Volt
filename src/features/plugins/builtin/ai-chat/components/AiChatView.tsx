import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  ChevronDown,
  ArrowLeft,
  AlertCircle,
  Sparkles,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { useAiChat, type ChatMessage } from '../hooks/useAiChat';
import { AI_PRESETS } from '../presets';
import { QuickActionIcon } from '../../../../ai-quick-actions/icons';
import { openSettingsWindow } from '../../../../../app/windows';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import type { ChatStatus } from 'ai';

interface ProviderStatus {
  provider: string;
  hasKey: boolean;
}

interface AiChatViewProps {
  onClose: () => void;
  initialQuery?: string;
  systemPrompt?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  groq: 'Groq',
  huggingface: 'Hugging Face',
};

const PROVIDER_LOGOS: Record<string, string> = {
  openai: '/ai/openai-color.webp',
  anthropic: '/ai/claude-color.svg',
  groq: '/ai/groq.svg',
  huggingface: '/ai/huggingface-color.webp',
};

/**
 * Provider logos that ship as a black-on-transparent asset. We render on a
 * dark canvas, so we flip these to white via a CSS filter. Single source of
 * truth — keep in sync with the matching constant in AiSettingsView.
 */
const MONOCHROME_LOGO_RE = /\/(openai|groq)/;

/** Dropdown option: either a selectable model or a non-selectable group header. */
type ModelEntry = { id: string; label: string; badge?: string };
type GroupHeader = { kind: 'group'; group: string };
type ModelOption = ModelEntry | GroupHeader;

function isGroupHeader(opt: ModelOption): opt is GroupHeader {
  return 'kind' in opt && opt.kind === 'group';
}

/**
 * Model catalogue as of 2026-05-21. Sources:
 *  - OpenAI:    https://developers.openai.com/api/docs/models/all  +  release notes
 *  - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
 *  - Groq:      https://console.groq.com/docs/models   (production tier only)
 *
 * Keep this file in sync when OpenAI/Anthropic/Groq publish new GA models.
 */
const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  openai: [
    { kind: 'group', group: 'GPT-5.5 (latest)' },
    { id: 'gpt-5.5', label: 'GPT-5.5', badge: 'Flagship' },
    { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
    { kind: 'group', group: 'GPT-5.4' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
    { kind: 'group', group: 'Codex (agentic coding)' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    { kind: 'group', group: 'GPT-5.2 / 5.1 chat' },
    { id: 'gpt-5.2-chat-latest', label: 'GPT-5.2 chat' },
    { id: 'gpt-5.1-chat-latest', label: 'GPT-5.1 chat' },
    { kind: 'group', group: 'GPT-5 (Aug 2025)' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini' },
    { id: 'gpt-5-nano', label: 'GPT-5 nano' },
    { kind: 'group', group: 'Reasoning (o-series)' },
    { id: 'o3', label: 'o3' },
    { id: 'o3-mini', label: 'o3-mini' },
    { kind: 'group', group: 'Legacy' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  anthropic: [
    { kind: 'group', group: 'Claude 4 (latest)' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', badge: 'Flagship' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { kind: 'group', group: 'Claude 4 (legacy)' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    { kind: 'group', group: 'Claude 3.5' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  groq: [
    { kind: 'group', group: 'Llama (production)' },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', badge: 'Recommended' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
    { kind: 'group', group: 'GPT-OSS' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
    { kind: 'group', group: 'Agentic (Compound)' },
    { id: 'groq/compound', label: 'Compound' },
    { id: 'groq/compound-mini', label: 'Compound mini' },
  ],
  // Hugging Face Inference Providers — OpenAI-compatible router that fans out
  // to Together/Fireworks/Novita/DeepInfra/Cerebras/... The default policy is
  // `:fastest`. To force a specific routing partner, append `:provider` to the
  // model id (e.g. "deepseek-ai/DeepSeek-V4-Pro:fireworks-ai"). The list below
  // covers the actively recommended chat-completion models as of 2026-05-21.
  // Docs: https://huggingface.co/docs/inference-providers/tasks/chat-completion
  huggingface: [
    { kind: 'group', group: 'DeepSeek' },
    {
      id: 'deepseek-ai/DeepSeek-V4-Pro',
      label: 'DeepSeek V4 Pro',
      badge: 'Flagship',
    },
    { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1 (reasoning)' },
    { kind: 'group', group: 'Qwen 3' },
    {
      id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      label: 'Qwen3 Coder 480B',
      badge: 'Coding',
    },
    { id: 'Qwen/Qwen3-4B-Thinking-2507', label: 'Qwen3 4B Thinking' },
    { kind: 'group', group: 'Qwen 2.5' },
    {
      id: 'Qwen/Qwen2.5-7B-Instruct-1M',
      label: 'Qwen 2.5 7B (1M ctx)',
    },
    { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B' },
    { kind: 'group', group: 'GLM (z.ai)' },
    { id: 'zai-org/GLM-5.1', label: 'GLM 5.1' },
    { id: 'zai-org/GLM-4.7', label: 'GLM 4.7' },
    { id: 'zai-org/GLM-4.5', label: 'GLM 4.5' },
    { kind: 'group', group: 'Llama 4 / 3' },
    { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct', label: 'Llama 4 Maverick' },
    { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', label: 'Llama 4 Scout' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B' },
    { id: 'meta-llama/Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B' },
    { kind: 'group', group: 'Kimi / Apertus' },
    { id: 'moonshotai/Kimi-K2.6', label: 'Kimi K2.6' },
    { id: 'swiss-ai/Apertus-8B-Instruct-2509', label: 'Apertus 8B' },
    { kind: 'group', group: 'GPT-OSS (open weights)' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
  ],
};

function selectableModels(opts: ModelOption[]): ModelEntry[] {
  return opts.filter((o): o is ModelEntry => !isGroupHeader(o));
}

function defaultModelFor(providerId: string): string {
  return selectableModels(PROVIDER_MODELS[providerId] ?? [])[0]?.id ?? '';
}

/** Compact inline dropdown — preferred over the cmd-K ModelSelector in the launcher's 800px window. */
function ProviderDropdown({
  value,
  options,
  onChange,
  leadingLogo,
}: {
  value: string;
  options: ModelOption[];
  onChange: (id: string) => void;
  leadingLogo?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectable = selectableModels(options);
  const selected = selectable.find((o) => o.id === value) ?? selectable[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 8px',
          borderRadius: 7,
          border: '1px solid var(--color-hairline)',
          background: open ? 'var(--color-canvas)' : 'var(--color-surface)',
          color: 'var(--color-ink)',
          fontSize: 12,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 0.12s',
        }}
      >
        {leadingLogo && (
          <img
            src={leadingLogo}
            alt=""
            width={13}
            height={13}
            style={{
              borderRadius: 3,
              objectFit: 'contain',
              filter: MONOCHROME_LOGO_RE.test(leadingLogo) ? 'invert(1)' : undefined,
            }}
          />
        )}
        {selected?.label ?? value}
        <ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--color-canvas)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 100,
            minWidth: 220,
            overflow: 'hidden',
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {options.map((opt, i) => {
            if (isGroupHeader(opt)) {
              return (
                <div
                  key={`group-${i}-${opt.group}`}
                  style={{
                    padding: '8px 12px 4px',
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: 'var(--color-mute)',
                    background: 'var(--color-surface)',
                    borderTop: i === 0 ? 'none' : '1px solid var(--color-hairline)',
                    userSelect: 'none',
                  }}
                >
                  {opt.group}
                </div>
              );
            }
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 12px',
                  background: isSelected ? 'rgba(168,85,247,0.12)' : 'none',
                  border: 'none',
                  color: isSelected ? 'var(--color-accent)' : 'var(--color-ink)',
                  fontSize: 13,
                  fontWeight: isSelected ? 500 : 400,
                  cursor: 'pointer',
                }}
              >
                <span>{opt.label}</span>
                {opt.badge && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(168,85,247,0.18)',
                      color: 'var(--color-accent)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {opt.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Render one assistant/user/error message using AI Elements primitives. */
function ChatMessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'error') {
    return (
      <Message from="assistant">
        <MessageContent
          className="border border-red-500/25 bg-red-500/10 text-red-400"
        >
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <AlertCircle size={13} />
            Error
          </span>
          <span className="whitespace-pre-wrap">{msg.content}</span>
        </MessageContent>
      </Message>
    );
  }

  // User messages stay as plain text — we don't want their markdown auto-rendered
  // (e.g. they pasted code and want it preserved verbatim in the prompt history).
  if (msg.role === 'user') {
    return (
      <Message from="user">
        <MessageContent>
          <span className="whitespace-pre-wrap break-words">{msg.content}</span>
        </MessageContent>
      </Message>
    );
  }

  // Assistant — full markdown via Streamdown (code blocks, tables, math, GFM).
  // `parseIncompleteMarkdown` (default true) handles half-streamed fences gracefully.
  return (
    <Message from="assistant">
      <MessageContent>
        {msg.isStreaming && !msg.content ? (
          <span className="text-xs italic opacity-60">Thinking…</span>
        ) : (
          <MessageResponse>{msg.content}</MessageResponse>
        )}
      </MessageContent>
    </Message>
  );
}

export function AiChatView({ onClose, initialQuery, systemPrompt }: AiChatViewProps) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState<string>(defaultModelFor('openai'));
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string | undefined>(systemPrompt);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const initSentRef = useRef(false);

  const { messages, isStreaming, send, clear, stop } = useAiChat({ provider, model });

  // Load which providers have keys. Read `provider` via functional setState so the
  // effect doesn't re-fire on user switches and clobber their choice.
  useEffect(() => {
    let cancelled = false;
    invoke<ProviderStatus[]>('ai_get_providers_status')
      .then((statuses) => {
        if (cancelled) return;
        setProviders(statuses);
        const configured = statuses.filter((s) => s.hasKey).map((s) => s.provider);
        setConfiguredProviders(configured);
        setProvider((curr) => {
          if (configured.length > 0 && !configured.includes(curr)) {
            const first = configured[0];
            setModel(defaultModelFor(first));
            return first;
          }
          return curr;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-send initial query once providers are loaded
  useEffect(() => {
    if (initSentRef.current) return;
    if (!initialQuery?.trim()) return;
    if (configuredProviders.length === 0) return;
    initSentRef.current = true;
    void send(initialQuery, activeSystemPrompt);
  }, [initialQuery, configuredProviders, send, activeSystemPrompt]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || isStreaming) return;
      void send(text, activeSystemPrompt);
      setActiveSystemPrompt(undefined);
    },
    [isStreaming, send, activeSystemPrompt]
  );

  const handlePreset = useCallback((presetId: string) => {
    const preset = AI_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActiveSystemPrompt(preset.system);
  }, []);

  const handleNewChat = useCallback(() => {
    clear();
    setActiveSystemPrompt(undefined);
    initSentRef.current = false;
  }, [clear]);

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    setModel(defaultModelFor(newProvider));
  }, []);

  const handleOpenSettings = useCallback(() => {
    void openSettingsWindow('ai');
  }, []);

  const noKeys = providers.length > 0 && configuredProviders.length === 0;
  const models = PROVIDER_MODELS[provider] ?? [];
  const selectableCount = useMemo(() => selectableModels(models).length, [models]);
  const activePreset = useMemo(
    () => AI_PRESETS.find((p) => p.system === activeSystemPrompt),
    [activeSystemPrompt]
  );

  /** Map our streaming state to AI Elements' ChatStatus for PromptInputSubmit. */
  const chatStatus: ChatStatus | undefined = useMemo(() => {
    if (!isStreaming) return undefined;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return lastAssistant?.content ? 'streaming' : 'submitted';
  }, [isStreaming, messages]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-canvas)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 48,
          padding: '0 12px',
          borderBottom: '1px solid var(--color-hairline)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: 'none',
            color: 'var(--color-mute)',
            cursor: 'pointer',
          }}
          title="Close (Esc)"
        >
          <ArrowLeft size={15} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          <Sparkles size={13} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>AI Chat</span>
        </div>

        {/* Provider selector */}
        {configuredProviders.length > 1 && (
          <ProviderDropdown
            value={provider}
            options={configuredProviders.map((p) => ({ id: p, label: PROVIDER_LABELS[p] ?? p }))}
            onChange={handleProviderChange}
            leadingLogo={PROVIDER_LOGOS[provider]}
          />
        )}
        {configuredProviders.length === 1 && PROVIDER_LOGOS[provider] && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 8px',
              borderRadius: 7,
              border: '1px solid var(--color-hairline)',
              background: 'var(--color-surface)',
              color: 'var(--color-mute)',
              fontSize: 12,
            }}
          >
            <img
              src={PROVIDER_LOGOS[provider]}
              alt=""
              width={13}
              height={13}
              style={{
                borderRadius: 3,
                objectFit: 'contain',
                filter: MONOCHROME_LOGO_RE.test(PROVIDER_LOGOS[provider]) ? 'invert(1)' : undefined,
              }}
            />
            {PROVIDER_LABELS[provider] ?? provider}
          </div>
        )}

        {/* Model selector */}
        {selectableCount > 1 && (
          <ProviderDropdown value={model} options={models} onChange={setModel} />
        )}

        {/* New chat */}
        <button
          onClick={handleNewChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 7,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink)',
            fontSize: 12,
            cursor: 'pointer',
          }}
          title="New conversation"
        >
          <Plus size={12} />
          New
        </button>
      </div>

      {/* No-key callout */}
      {noKeys && (
        <div
          style={{
            padding: '10px 14px',
            background:
              'linear-gradient(90deg, rgba(168,85,247,0.10) 0%, rgba(139,92,246,0.06) 100%)',
            borderBottom: '1px solid rgba(168,85,247,0.18)',
            fontSize: 12,
            color: 'var(--color-ink)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AlertCircle size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span style={{ flex: 1, color: 'var(--color-mute)' }}>
            Add an API key to start chatting.
          </span>
          <button
            onClick={handleOpenSettings}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 7,
              border: '1px solid rgba(168,85,247,0.35)',
              background: 'rgba(168,85,247,0.18)',
              color: 'var(--color-accent)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <SettingsIcon size={12} />
            Open Settings
          </button>
        </div>
      )}

      {/* Active preset banner */}
      {activeSystemPrompt && (
        <div
          style={{
            padding: '7px 14px',
            background: 'rgba(168,85,247,0.10)',
            borderBottom: '1px solid rgba(168,85,247,0.18)',
            fontSize: 12,
            color: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {activePreset && (
            <QuickActionIcon name={activePreset.icon} size={13} strokeWidth={2} />
          )}
          <span style={{ flex: 1 }}>
            Preset active:{' '}
            <strong style={{ fontWeight: 600 }}>{activePreset?.label ?? 'Custom'}</strong>
          </span>
          <button
            onClick={() => setActiveSystemPrompt(undefined)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: 4,
              background: 'none',
              border: 'none',
              color: 'var(--color-accent)',
              cursor: 'pointer',
              opacity: 0.8,
            }}
            title="Clear preset"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Conversation (auto-scroll + scroll-to-bottom button) */}
      <Conversation>
        <ConversationContent>
          {messages.length === 0 && !isStreaming ? (
            <ConversationEmptyState
              icon={
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background:
                      'linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(139,92,246,0.12) 100%)',
                    border: '1px solid rgba(168,85,247,0.22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-accent)',
                  }}
                >
                  <Sparkles size={26} strokeWidth={1.6} />
                </div>
              }
              title={noKeys ? 'Add an API key to start chatting' : 'Ask anything'}
              description={
                noKeys
                  ? 'Connect OpenAI, Anthropic, or Groq in Settings → AI.'
                  : 'Type a question below or pick a preset to transform clipboard text.'
              }
            />
          ) : (
            messages.map((msg) => <ChatMessageView key={msg.id} msg={msg} />)
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Preset chips */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--color-hairline)',
          flexShrink: 0,
        }}
      >
        <Suggestions>
          {AI_PRESETS.map((preset) => {
            const isActive = activeSystemPrompt === preset.system;
            return (
              <Suggestion
                key={preset.id}
                suggestion={preset.id}
                onClick={() => handlePreset(preset.id)}
                variant={isActive ? 'default' : 'outline'}
                className={isActive ? 'border-purple-500/60 bg-purple-500/15 text-purple-300' : ''}
              >
                <QuickActionIcon
                  name={preset.icon}
                  size={13}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                {preset.label}
              </Suggestion>
            );
          })}
        </Suggestions>
      </div>

      {/* Input */}
      <PromptInput
        onSubmit={handleSubmit}
        accept="image/*"
        multiple
        maxFiles={4}
        maxFileSize={8 * 1024 * 1024}
        style={{
          borderTop: '1px solid var(--color-hairline)',
          borderRadius: 0,
          background: 'var(--color-canvas)',
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={
              noKeys
                ? 'Add an API key in Settings → AI to start chatting'
                : 'Ask anything…  (Enter to send, Shift+Enter for newline)'
            }
            disabled={noKeys}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            status={chatStatus}
            onStop={stop}
            disabled={noKeys}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
