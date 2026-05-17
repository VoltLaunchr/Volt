import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Plus, ChevronDown, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useAiChat, type ChatMessage } from '../hooks/useAiChat';
import { AI_PRESETS } from '../presets';

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
};

const PROVIDER_LOGOS: Record<string, string> = {
  openai: '/ai/openai-color.svg',
  anthropic: '/ai/claude-color.svg',
  groq: '/ai/groq.svg',
};

const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'o1-mini', label: 'o1-mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
    { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
};

function StreamingCursor() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 2,
        height: '1em',
        background: 'var(--color-accent)',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'ai-cursor-blink 0.9s step-end infinite',
      }}
    />
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser
            ? 'var(--color-accent)'
            : isError
              ? 'rgba(239,68,68,0.12)'
              : 'var(--color-surface)',
          border: isError ? '1px solid rgba(239,68,68,0.25)' : '1px solid transparent',
          color: isUser ? '#fff' : isError ? '#f87171' : 'var(--color-ink)',
          fontSize: 13,
          lineHeight: 1.6,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {isError && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <AlertCircle size={13} />
            <strong style={{ fontSize: 12 }}>Error</strong>
          </span>
        )}
        {msg.content}
        {msg.isStreaming && <StreamingCursor />}
        {msg.isStreaming && !msg.content && (
          <span style={{ opacity: 0.5, fontStyle: 'italic', fontSize: 12 }}>Thinking…</span>
        )}
      </div>
    </div>
  );
}

function ProviderDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
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

  const selected = options.find((o) => o.id === value) ?? options[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid var(--color-hairline)',
          background: 'var(--color-surface)',
          color: 'var(--color-mute)',
          fontSize: 12,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {selected?.label ?? value}
        <ChevronDown size={11} />
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
            minWidth: 160,
            overflow: 'hidden',
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: opt.id === value ? 'var(--color-surface)' : 'none',
                border: 'none',
                color: 'var(--color-ink)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiChatView({ onClose, initialQuery, systemPrompt }: AiChatViewProps) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState<string>(PROVIDER_MODELS.openai[0].id);
  const [input, setInput] = useState('');
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string | undefined>(systemPrompt);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initSentRef = useRef(false);

  const { messages, isStreaming, send, clear } = useAiChat({ provider, model });

  // Load which providers have keys
  useEffect(() => {
    invoke<ProviderStatus[]>('ai_get_providers_status')
      .then((statuses) => {
        setProviders(statuses);
        const configured = statuses.filter((s) => s.hasKey).map((s) => s.provider);
        setConfiguredProviders(configured);
        if (configured.length > 0 && !configured.includes(provider)) {
          const first = configured[0];
          setProvider(first);
          setModel(PROVIDER_MODELS[first]?.[0]?.id ?? '');
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send initial query once providers are loaded
  useEffect(() => {
    if (initSentRef.current) return;
    if (!initialQuery?.trim()) return;
    if (configuredProviders.length === 0) return;
    initSentRef.current = true;
    void send(initialQuery, activeSystemPrompt);
  }, [initialQuery, configuredProviders, send, activeSystemPrompt]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (!initialQuery) inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    void send(input.trim(), activeSystemPrompt);
    setInput('');
    setActiveSystemPrompt(undefined);
  }, [input, isStreaming, send, activeSystemPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape') onClose();
    },
    [handleSend, onClose]
  );

  const handlePreset = useCallback(
    (presetId: string) => {
      const preset = AI_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setActiveSystemPrompt(preset.system);
      inputRef.current?.focus();
    },
    []
  );

  const handleNewChat = useCallback(() => {
    clear();
    setActiveSystemPrompt(undefined);
    setInput('');
    initSentRef.current = false;
    inputRef.current?.focus();
  }, [clear]);

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    setModel(PROVIDER_MODELS[newProvider]?.[0]?.id ?? '');
  }, []);

  const noKeys = providers.length > 0 && configuredProviders.length === 0;
  const models = PROVIDER_MODELS[provider] ?? [];

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
      <style>{`
        @keyframes ai-cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

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

        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', flex: 1 }}>
          AI Chat
        </span>

        {/* Provider selector */}
        {configuredProviders.length >= 1 && PROVIDER_LOGOS[provider] && (
          <img
            src={PROVIDER_LOGOS[provider]}
            alt=""
            width={16}
            height={16}
            style={{ borderRadius: 4, objectFit: 'contain' }}
          />
        )}
        {configuredProviders.length > 1 && (
          <ProviderDropdown
            value={provider}
            options={configuredProviders.map((p) => ({ id: p, label: PROVIDER_LABELS[p] ?? p }))}
            onChange={handleProviderChange}
          />
        )}

        {/* Model selector */}
        {models.length > 1 && (
          <ProviderDropdown
            value={model}
            options={models}
            onChange={setModel}
          />
        )}

        {/* New chat */}
        <button
          onClick={handleNewChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-mute)',
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
            padding: '10px 16px',
            background: 'rgba(168,85,247,0.08)',
            borderBottom: '1px solid rgba(168,85,247,0.15)',
            fontSize: 12,
            color: 'var(--color-mute)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={13} style={{ color: 'var(--color-accent)' }} />
          No API keys configured. Open{' '}
          <strong style={{ color: 'var(--color-ink)' }}>Settings → AI</strong> to add one.
        </div>
      )}

      {/* Active preset banner */}
      {activeSystemPrompt && (
        <div
          style={{
            padding: '6px 16px',
            background: 'rgba(168,85,247,0.08)',
            borderBottom: '1px solid rgba(168,85,247,0.15)',
            fontSize: 12,
            color: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            Preset active: <strong>{AI_PRESETS.find((p) => p.system === activeSystemPrompt)?.label ?? 'Custom'}</strong>
          </span>
          <button
            onClick={() => setActiveSystemPrompt(undefined)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-accent)',
              fontSize: 11,
              cursor: 'pointer',
              opacity: 0.7,
            }}
          >
            Clear ×
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {messages.length === 0 && !isStreaming && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 8,
              color: 'var(--color-mute)',
            }}
          >
            <img src="/icons/app/ai_icon.svg" alt="" width={48} height={48} style={{ opacity: 0.6 }} />
            <p style={{ margin: 0, fontSize: 13 }}>
              {noKeys ? 'Add an API key to start chatting' : 'Ask anything'}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Preset chips */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '6px 12px',
          overflowX: 'auto',
          flexShrink: 0,
          borderTop: '1px solid var(--color-hairline)',
          scrollbarWidth: 'none',
        }}
      >
        {AI_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handlePreset(preset.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 20,
              border: `1px solid ${activeSystemPrompt === preset.system ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
              background:
                activeSystemPrompt === preset.system ? 'rgba(168,85,247,0.1)' : 'var(--color-surface)',
              color:
                activeSystemPrompt === preset.system ? 'var(--color-accent)' : 'var(--color-mute)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span aria-hidden>{preset.icon}</span>
            {preset.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '10px 12px',
          borderTop: '1px solid var(--color-hairline)',
          flexShrink: 0,
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
          disabled={isStreaming || noKeys}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            padding: '9px 12px',
            borderRadius: 10,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink)',
            fontSize: 13,
            lineHeight: 1.5,
            outline: 'none',
            fontFamily: 'inherit',
            maxHeight: 120,
            overflow: 'auto',
            opacity: (isStreaming || noKeys) ? 0.6 : 1,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isStreaming || noKeys}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 10,
            border: 'none',
            background: !input.trim() || isStreaming || noKeys ? 'var(--color-surface)' : 'var(--color-accent)',
            color: !input.trim() || isStreaming || noKeys ? 'var(--color-mute)' : '#fff',
            cursor: !input.trim() || isStreaming || noKeys ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s',
          }}
          title="Send (Enter)"
        >
          {isStreaming ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
