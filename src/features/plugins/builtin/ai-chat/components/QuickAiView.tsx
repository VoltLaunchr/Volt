import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  MessageSquare,
  RotateCw,
  Sparkles,
  AlertCircle,
  Check,
} from 'lucide-react';
import { useAiChat } from '../hooks/useAiChat';
import { VOLT_EVENTS, emitVoltEvent } from '../../../../../shared/events';
import { AiProviderLogo } from '../../../../../shared/components/ui';

interface ProviderStatus {
  provider: string;
  hasKey: boolean;
}

interface QuickAiViewProps {
  onClose: () => void;
  /** The user's question — sent on mount. Required. */
  initialQuery: string;
  /** Optional system prompt (e.g. when triggered from a preset/quick action). */
  systemPrompt?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  groq: 'Groq',
};

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  groq: 'llama-3.1-8b-instant',
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
        animation: 'quickai-cursor-blink 0.9s step-end infinite',
      }}
    />
  );
}

export function QuickAiView({ onClose, initialQuery, systemPrompt }: QuickAiViewProps) {
  const [provider, setProvider] = useState<string>('openai');
  const [model, setModel] = useState<string>(PROVIDER_DEFAULT_MODEL.openai);
  const [noKeys, setNoKeys] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingRegen, setPendingRegen] = useState(false);
  const sentRef = useRef(false);
  const lastQueryRef = useRef(initialQuery);
  const lastSystemRef = useRef(systemPrompt);

  const { messages, isStreaming, send, clear } = useAiChat({ provider, model });

  // Load the configured providers; pick the first one with a key.
  useEffect(() => {
    invoke<ProviderStatus[]>('ai_get_providers_status')
      .then((statuses) => {
        const configured = statuses.filter((s) => s.hasKey).map((s) => s.provider);
        if (configured.length === 0) {
          setNoKeys(true);
          return;
        }
        const picked = configured[0];
        setProvider(picked);
        setModel(PROVIDER_DEFAULT_MODEL[picked] ?? '');
      })
      .catch(() => setNoKeys(true));
  }, []);

  // Auto-send the initial query once provider is locked in (or noKeys is resolved).
  useEffect(() => {
    if (sentRef.current) return;
    if (noKeys) return;
    if (!initialQuery?.trim()) return;
    // Wait until we have a real provider/model resolved (model defaults are stable per provider)
    sentRef.current = true;
    void send(initialQuery, systemPrompt);
  }, [initialQuery, systemPrompt, send, noKeys]);

  // Track last sent values so Regenerate can replay them
  useEffect(() => {
    lastQueryRef.current = initialQuery;
    lastSystemRef.current = systemPrompt;
  }, [initialQuery, systemPrompt]);

  const userMessage = useMemo(() => messages.find((m) => m.role === 'user'), [messages]);
  const aiMessage = useMemo(
    () => messages.filter((m) => m.role === 'assistant' || m.role === 'error').slice(-1)[0],
    [messages]
  );

  const handleCopy = useCallback(async () => {
    if (!aiMessage?.content) return;
    try {
      await navigator.clipboard.writeText(aiMessage.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore — clipboard permissions can be blocked in some webviews
    }
  }, [aiMessage]);

  const handleRegenerate = useCallback(() => {
    if (isStreaming) return;
    clear();
    sentRef.current = false;
    // Defer send to the effect below so we don't race the clear() flush.
    setPendingRegen(true);
  }, [clear, isStreaming]);

  // Fire the deferred regenerate once `clear()` has flushed (messages == 0).
  useEffect(() => {
    if (!pendingRegen) return;
    if (messages.length > 0) return;
    setPendingRegen(false);
    sentRef.current = true;
    void send(lastQueryRef.current, lastSystemRef.current);
  }, [pendingRegen, messages.length, send]);

  const handleOpenInChat = useCallback(() => {
    emitVoltEvent(VOLT_EVENTS.OPEN_AI_CHAT, {
      query: lastQueryRef.current,
      systemPrompt: lastSystemRef.current,
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'c' &&
        !window.getSelection()?.toString()
      ) {
        // Only intercept Cmd/Ctrl+C if nothing is selected (otherwise let native copy work)
        e.preventDefault();
        void handleCopy();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r' && !isStreaming) {
        e.preventDefault();
        handleRegenerate();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenInChat();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, handleCopy, handleRegenerate, handleOpenInChat, isStreaming]);

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
        @keyframes quickai-cursor-blink {
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
          height: 44,
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
            width: 26,
            height: 26,
            borderRadius: 6,
            border: 'none',
            background: 'none',
            color: 'var(--color-mute)',
            cursor: 'pointer',
          }}
          title="Close (Esc)"
        >
          <ArrowLeft size={14} />
        </button>

        <Sparkles size={13} style={{ color: 'var(--color-accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', flex: 1 }}>
          Quick AI
        </span>

        <AiProviderLogo provider={provider} size={14} />
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            color: 'var(--color-mute)',
          }}
        >
          {PROVIDER_LABELS[provider] ?? provider} / {model}
        </span>
      </div>

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

      {/* Body: question + answer */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {userMessage && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-ink)',
              lineHeight: 1.5,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-hairline)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--color-mute)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                marginBottom: 4,
              }}
            >
              Question
            </div>
            {userMessage.content}
          </div>
        )}

        {aiMessage && (
          <div
            style={{
              fontSize: 13,
              color: aiMessage.role === 'error' ? '#f87171' : 'var(--color-ink)',
              lineHeight: 1.7,
              padding: '12px 14px',
              borderRadius: 10,
              background: aiMessage.role === 'error' ? 'rgba(239,68,68,0.08)' : 'transparent',
              border:
                aiMessage.role === 'error'
                  ? '1px solid rgba(239,68,68,0.25)'
                  : '1px solid transparent',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {aiMessage.role === 'error' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 6,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <AlertCircle size={13} />
                Error
              </div>
            )}
            {aiMessage.content}
            {aiMessage.isStreaming && <StreamingCursor />}
            {aiMessage.isStreaming && !aiMessage.content && (
              <span style={{ opacity: 0.5, fontStyle: 'italic', fontSize: 12 }}>Thinking…</span>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderTop: '1px solid var(--color-hairline)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => void handleCopy()}
          disabled={!aiMessage?.content || isStreaming}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 7,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: !aiMessage?.content || isStreaming ? 'var(--color-mute)' : 'var(--color-ink)',
            fontSize: 12,
            cursor: !aiMessage?.content || isStreaming ? 'not-allowed' : 'pointer',
            opacity: !aiMessage?.content || isStreaming ? 0.5 : 1,
          }}
          title="Copy (⌘C)"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button
          onClick={handleRegenerate}
          disabled={isStreaming}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 7,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: isStreaming ? 'var(--color-mute)' : 'var(--color-ink)',
            fontSize: 12,
            cursor: isStreaming ? 'not-allowed' : 'pointer',
            opacity: isStreaming ? 0.5 : 1,
          }}
          title="Regenerate (⌘R)"
        >
          <RotateCw size={12} />
          Regenerate
        </button>

        <button
          onClick={handleOpenInChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 7,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink)',
            fontSize: 12,
            cursor: 'pointer',
          }}
          title="Continue in Chat (⌘O)"
        >
          <MessageSquare size={12} />
          Open in Chat
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 11, color: 'var(--color-mute)' }}>Esc to close</span>
      </div>
    </div>
  );
}
