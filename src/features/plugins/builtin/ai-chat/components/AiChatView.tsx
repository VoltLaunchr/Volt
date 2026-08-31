import { invoke } from '@tauri-apps/api/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Plus,
  ChevronDown,
  ArrowLeft,
  AlertCircle,
  Check,
  Cpu,
  ShieldQuestion,
  Sparkles,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { useAiChat, type ChatImage, type ChatMessage, type ChatPart } from '../hooks/useAiChat';
import {
  LOCAL_PROVIDER_ID,
  loadLocalConfig,
  onLocalConfigChange,
  type LocalAiConfig,
} from '../lib/localProvider';
import {
  getPendingApproval,
  respondToolApproval,
  subscribeToolApprovals,
} from '../lib/aiToolApproval';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { isDynamicToolUIPart } from 'ai';
import { AI_PRESETS } from '../presets';
import { QuickActionIcon } from '../../../../ai-quick-actions/icons';
import { openSettingsWindow } from '../../../../../app/windows';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { Suggestion } from '@/components/ai-elements/suggestion';
import type { ChatStatus, FileUIPart } from 'ai';

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
  [LOCAL_PROVIDER_ID]: 'Local',
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

/**
 * AI surface accent — Volt's brand indigo (`--color-primary` / `--color-accent-blue`,
 * = Tailwind `indigo-500`). Single source of truth so the AI surface stays on-brand
 * across the header, empty state, composer, and CTAs.
 */
const AI_ACCENT = '#6366f1';
/** Soft indigo tints (rgb 99 102 241 / 79 70 229) for fills, borders, and gradients. */
const AI_TINT = {
  grad: 'linear-gradient(135deg, rgba(99,102,241,0.20) 0%, rgba(79,70,229,0.10) 100%)',
  border: 'rgba(99,102,241,0.28)',
  fill: 'rgba(99,102,241,0.16)',
  fillBorder: 'rgba(99,102,241,0.40)',
  banner: 'rgba(99,102,241,0.10)',
  bannerBorder: 'rgba(99,102,241,0.20)',
};

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
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  const selectable = selectableModels(options);
  const selected = selectable.find((o) => o.id === value) ?? selectable[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Select model — current: ${selected?.label ?? value}`}
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
          role="listbox"
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
                role="option"
                aria-selected={isSelected}
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
                  background: isSelected ? 'rgba(99,102,241,0.12)' : 'none',
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
                      background: 'rgba(99,102,241,0.18)',
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

/**
 * Horizontally-scrollable preset rail. The launcher window is only 800px wide,
 * so the 8 presets always overflow. The shared <Suggestions> hides its scrollbar,
 * which silently clips the trailing chips — this rail adds edge-fade affordances
 * (so it's obvious more presets exist), translates vertical wheel into horizontal
 * scroll, and owns the single divider that separates the conversation from the
 * composer below.
 */
function PresetBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  // Click-vs-drag arbitration: a pointer-down that turns into a drag must NOT
  // fire the chip's onClick. `dragged` stays true through the synthetic click
  // that follows pointerup, which onClickCapture then swallows.
  const drag = useRef({ down: false, startX: 0, startLeft: 0, dragged: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update]);

  const handleWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.deltaY === 0) return;
    ref.current?.scrollBy({ left: e.deltaY });
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    drag.current = { down: true, startX: e.clientX, startLeft: el.scrollLeft, dragged: false };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const s = drag.current;
    if (!el || !s.down) return;
    const dx = e.clientX - s.startX;
    if (!s.dragged && Math.abs(dx) > 4) {
      s.dragged = true;
      setGrabbing(true);
      el.setPointerCapture?.(e.pointerId);
    }
    if (s.dragged) el.scrollLeft = s.startLeft - dx;
  }, []);

  const endDrag = useCallback(() => {
    drag.current.down = false;
    setGrabbing(false);
  }, []);

  // Swallow the click that a drag would otherwise trigger on the underlying chip.
  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (drag.current.dragged) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.dragged = false;
    }
  }, []);

  const fadeBase = {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 32,
    pointerEvents: 'none' as const,
    transition: 'opacity 0.15s',
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div
        ref={ref}
        onScroll={update}
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
        className="volt-preset-rail"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          overflowX: 'auto',
          padding: '10px 12px 8px',
          scrollbarWidth: 'none',
          cursor: grabbing ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'pan-x',
        }}
      >
        {children}
      </div>
      <div
        aria-hidden
        style={{
          ...fadeBase,
          left: 0,
          width: 24,
          background: 'linear-gradient(90deg, var(--color-canvas), transparent)',
          opacity: atStart ? 0 : 1,
        }}
      />
      <div
        aria-hidden
        style={{
          ...fadeBase,
          right: 0,
          background: 'linear-gradient(270deg, var(--color-canvas), transparent)',
          opacity: atEnd ? 0 : 1,
        }}
      />
      <style>{`.volt-preset-rail::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}

/** Render one assistant/user/error message using AI Elements primitives. */
/**
 * Convert a `PromptInput` attachment into a wire `ChatImage`. `PromptInput`
 * has already turned blob URLs into `data:` URLs, so we just split out the
 * base64 payload. Non-image attachments are dropped.
 */
function fileToChatImage(file: FileUIPart): ChatImage | null {
  const { url, mediaType } = file;
  if (!url || !mediaType?.startsWith('image/')) return null;
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const data = url.slice(comma + 1);
  if (!data) return null;
  return { mediaType, data };
}

function MessageImages({ images }: { images: ChatImage[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {images.map((img, i) => (
        <img
          key={i}
          src={`data:${img.mediaType};base64,${img.data}`}
          alt="Attached image"
          className="max-h-40 max-w-[200px] rounded-lg border border-hairline object-cover"
        />
      ))}
    </div>
  );
}

/** Render a single tool call (input + output/error) as a collapsible card. */
function ToolPartView({ part }: { part: Extract<ChatPart, { kind: 'tool' }>['part'] }) {
  const isError = part.state === 'output-error';
  return (
    <Tool defaultOpen={isError}>
      {isDynamicToolUIPart(part) ? (
        <ToolHeader type="dynamic-tool" state={part.state} toolName={part.toolName} />
      ) : (
        <ToolHeader type={part.type} state={part.state} />
      )}
      <ToolContent>
        <ToolInput input={part.input} />
        {part.state === 'output-available' && (
          <ToolOutput output={part.output} errorText={undefined} />
        )}
        {part.state === 'output-error' && (
          <ToolOutput output={undefined} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}

/** Render one ordered part of an assistant message (text / reasoning / tool). */
function AssistantPart({ part, streaming }: { part: ChatPart; streaming?: boolean }) {
  if (part.kind === 'text') {
    if (!part.text) return null;
    return <MessageResponse>{part.text}</MessageResponse>;
  }
  if (part.kind === 'reasoning') {
    return (
      <Reasoning isStreaming={streaming} className="mb-2">
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }
  return <ToolPartView part={part.part} />;
}

function ChatMessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'error') {
    return (
      <Message from="assistant">
        <MessageContent className="border border-red-500/25 bg-red-500/10 text-red-400">
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
          {msg.images && msg.images.length > 0 && <MessageImages images={msg.images} />}
          <span className="whitespace-pre-wrap break-words">{msg.content}</span>
        </MessageContent>
      </Message>
    );
  }

  // Assistant — render parts in stream order: reasoning (J3), tool calls (J1)
  // and text (markdown via Streamdown; `parseIncompleteMarkdown` handles
  // half-streamed fences). Falls back to a "Thinking…" placeholder while the
  // first token is still pending.
  const parts = msg.parts ?? [];
  const hasRenderable = parts.some((p) => p.kind !== 'text' || p.text.length > 0);
  return (
    <Message from="assistant">
      <MessageContent>
        {!hasRenderable && msg.isStreaming ? (
          <span className="volt-shimmer-text text-xs italic">Thinking…</span>
        ) : (
          parts.map((part, i) => <AssistantPart key={i} part={part} streaming={msg.isStreaming} />)
        )}
      </MessageContent>
    </Message>
  );
}

/** Inline Approve/Deny card for a pending side-effecting tool (J1). */
function ToolApprovalCard() {
  const pending = useSyncExternalStore(
    subscribeToolApprovals,
    getPendingApproval,
    getPendingApproval
  );
  if (!pending) return null;
  return (
    <div
      style={{
        margin: '0 12px 8px',
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${AI_TINT.fillBorder}`,
        background: AI_TINT.fill,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldQuestion size={15} style={{ color: AI_ACCENT, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)' }}>
            {pending.title}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-mute)', wordBreak: 'break-word' }}>
            {pending.summary}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={() => respondToolApproval(pending.id, false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 12px',
            borderRadius: 7,
            border: '1px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <X size={12} />
          Deny
        </button>
        <button
          onClick={() => respondToolApproval(pending.id, true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 12px',
            borderRadius: 7,
            border: `1px solid ${AI_TINT.fillBorder}`,
            background: AI_ACCENT,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Check size={12} />
          Approve
        </button>
      </div>
    </div>
  );
}

export function AiChatView({ onClose, initialQuery, systemPrompt }: AiChatViewProps) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState<string>(defaultModelFor('openai'));
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string | undefined>(systemPrompt);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [localConfig, setLocalConfig] = useState<LocalAiConfig | null>(null);
  const initSentRef = useRef(false);

  // A local provider (Ollama / LM Studio) is configured renderer-side; react to
  // saves made in the settings window (cross-window `storage` event).
  useEffect(() => {
    setLocalConfig(loadLocalConfig());
    return onLocalConfigChange(() => setLocalConfig(loadLocalConfig()));
  }, []);

  // Providers the user can actually pick: keyed cloud providers + local (if set).
  const availableProviders = useMemo(
    () => (localConfig ? [...configuredProviders, LOCAL_PROVIDER_ID] : configuredProviders),
    [configuredProviders, localConfig]
  );

  const baseUrl = provider === LOCAL_PROVIDER_ID ? localConfig?.baseUrl : undefined;
  const { messages, isStreaming, send, clear, stop } = useAiChat({ provider, model, baseUrl });

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

  // When the current provider isn't available (e.g. no cloud keys) but a local
  // one is configured, fall back to it so the chat is usable offline.
  useEffect(() => {
    if (!localConfig) return;
    setProvider((curr) => {
      if (availableProviders.includes(curr)) return curr;
      setModel(localConfig.model);
      return LOCAL_PROVIDER_ID;
    });
  }, [localConfig, availableProviders]);

  // Auto-send initial query once a provider is available
  useEffect(() => {
    if (initSentRef.current) return;
    if (!initialQuery?.trim()) return;
    if (availableProviders.length === 0) return;
    initSentRef.current = true;
    void send(initialQuery, activeSystemPrompt);
  }, [initialQuery, availableProviders, send, activeSystemPrompt]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || isStreaming) return;
      const images = (message.files ?? [])
        .map(fileToChatImage)
        .filter((img): img is ChatImage => img !== null);
      void send(text, activeSystemPrompt, images);
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

  const handleProviderChange = useCallback(
    (newProvider: string) => {
      setProvider(newProvider);
      setModel(
        newProvider === LOCAL_PROVIDER_ID
          ? (localConfig?.model ?? '')
          : defaultModelFor(newProvider)
      );
    },
    [localConfig]
  );

  const handleOpenSettings = useCallback(() => {
    void openSettingsWindow('ai');
  }, []);

  // "No usable provider": cloud status loaded with zero keys AND no local config.
  const noKeys = providers.length > 0 && availableProviders.length === 0;
  const models = useMemo<ModelOption[]>(
    () =>
      provider === LOCAL_PROVIDER_ID
        ? localConfig
          ? [{ id: localConfig.model, label: localConfig.model }]
          : []
        : (PROVIDER_MODELS[provider] ?? []),
    [localConfig, provider]
  );
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
          aria-label="Close AI Chat"
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
          <Sparkles size={13} style={{ color: AI_ACCENT }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>AI Chat</span>
        </div>

        {/* Provider selector */}
        {availableProviders.length > 1 && (
          <ProviderDropdown
            value={provider}
            options={availableProviders.map((p) => ({ id: p, label: PROVIDER_LABELS[p] ?? p }))}
            onChange={handleProviderChange}
            leadingLogo={PROVIDER_LOGOS[provider]}
          />
        )}
        {availableProviders.length === 1 && (
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
            {PROVIDER_LOGOS[provider] ? (
              <img
                src={PROVIDER_LOGOS[provider]}
                alt=""
                width={13}
                height={13}
                style={{
                  borderRadius: 3,
                  objectFit: 'contain',
                  filter: MONOCHROME_LOGO_RE.test(PROVIDER_LOGOS[provider])
                    ? 'invert(1)'
                    : undefined,
                }}
              />
            ) : (
              <Cpu size={13} style={{ color: AI_ACCENT }} />
            )}
            {PROVIDER_LABELS[provider] ?? provider}
          </div>
        )}

        {/* Model selector — hidden until a provider key exists (nothing to run otherwise) */}
        {!noKeys && selectableCount > 1 && (
          <ProviderDropdown value={model} options={models} onChange={setModel} />
        )}

        {/* New chat */}
        <button
          onClick={handleNewChat}
          aria-label="New conversation"
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

      {/* Active preset banner */}
      {activeSystemPrompt && (
        <div
          style={{
            padding: '7px 14px',
            background: AI_TINT.banner,
            borderBottom: `1px solid ${AI_TINT.bannerBorder}`,
            fontSize: 12,
            color: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {activePreset && <QuickActionIcon name={activePreset.icon} size={13} strokeWidth={2} />}
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
            noKeys ? (
              <ConversationEmptyState>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 16,
                    maxWidth: 320,
                  }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 16,
                      background: AI_TINT.grad,
                      border: `1px solid ${AI_TINT.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: AI_ACCENT,
                    }}
                  >
                    <Sparkles size={26} strokeWidth={1.6} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 15,
                        fontWeight: 600,
                        color: 'var(--color-ink)',
                      }}
                    >
                      Connect an AI provider
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: 'var(--color-mute)',
                      }}
                    >
                      Add an API key to start chatting — pick any provider below.
                    </p>
                  </div>

                  {/* Provider trust row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {Object.entries(PROVIDER_LOGOS).map(([id, logo]) => (
                      <img
                        key={id}
                        src={logo}
                        alt={PROVIDER_LABELS[id] ?? id}
                        title={PROVIDER_LABELS[id] ?? id}
                        width={20}
                        height={20}
                        style={{
                          borderRadius: 4,
                          objectFit: 'contain',
                          opacity: 0.85,
                          filter: MONOCHROME_LOGO_RE.test(logo) ? 'invert(1)' : undefined,
                        }}
                      />
                    ))}
                  </div>

                  <button
                    onClick={handleOpenSettings}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: `1px solid ${AI_TINT.fillBorder}`,
                      background: AI_TINT.fill,
                      color: AI_ACCENT,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <SettingsIcon size={14} />
                    Open Settings
                  </button>

                  <span style={{ fontSize: 11, color: 'var(--color-mute)' }}>
                    Keys are stored locally in your OS keychain.
                  </span>
                </div>
              </ConversationEmptyState>
            ) : (
              <ConversationEmptyState
                icon={
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 16,
                      background: AI_TINT.grad,
                      border: `1px solid ${AI_TINT.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: AI_ACCENT,
                    }}
                  >
                    <Sparkles size={26} strokeWidth={1.6} />
                  </div>
                }
                title="Ask anything"
                description="Type a question below or pick a preset to transform clipboard text."
              />
            )
          ) : (
            messages.map((msg) => <ChatMessageView key={msg.id} msg={msg} />)
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Composer — preset rail + input as one cohesive block, divided from the
          conversation by a single hairline. */}
      <div
        style={{
          borderTop: '1px solid var(--color-hairline)',
          background: 'var(--color-canvas)',
          flexShrink: 0,
        }}
      >
        {/* Preset chips — hidden without a key: they'd set a preset the disabled input can't send */}
        {!noKeys && (
          <PresetBar>
            {AI_PRESETS.map((preset) => {
              const isActive = activeSystemPrompt === preset.system;
              return (
                <Suggestion
                  key={preset.id}
                  suggestion={preset.id}
                  onClick={() => handlePreset(preset.id)}
                  variant={isActive ? 'default' : 'outline'}
                  className={
                    isActive
                      ? 'shrink-0 border-indigo-500/60 bg-indigo-500/15 text-indigo-300'
                      : 'shrink-0'
                  }
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
          </PresetBar>
        )}

        {/* Tool approval prompt — gates side-effecting tool calls (J1). */}
        <ToolApprovalCard />

        {/* Input — contained rounded surface card (not a full-bleed field). The
            inner InputGroup is restyled to brand tokens; its border turns indigo
            on focus for an on-brand focus affordance. */}
        <div style={{ padding: noKeys ? '12px' : '2px 12px 12px' }}>
          <PromptInput
            onSubmit={handleSubmit}
            accept="image/*"
            multiple
            maxFiles={4}
            maxFileSize={8 * 1024 * 1024}
            className="**:data-[slot=input-group]:rounded-xl **:data-[slot=input-group]:border-hairline **:data-[slot=input-group]:bg-surface **:data-[slot=input-group]:transition-colors **:data-[slot=input-group]:hover:border-hairline-strong **:data-[slot=input-group]:has-focus-visible:border-(--color-primary)"
          >
            <PromptInputBody>
              <PromptInputTextarea
                placeholder={
                  noKeys
                    ? 'Connect a provider to start chatting…'
                    : 'Ask anything…  (Enter to send, Shift+Enter for newline)'
                }
                disabled={noKeys}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit status={chatStatus} onStop={stop} disabled={noKeys} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
