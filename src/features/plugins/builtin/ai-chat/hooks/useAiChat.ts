import { invoke } from '@tauri-apps/api/core';
import { useChat } from '@ai-sdk/react';
import {
  isDynamicToolUIPart,
  isToolUIPart,
  type DynamicToolUIPart,
  type FileUIPart,
  type ToolUIPart,
  type UIMessage,
} from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createVoltChatTransport } from '../lib/aiTransport';
import { cancelAllToolApprovals } from '../lib/aiToolApproval';

export type ChatRole = 'user' | 'assistant' | 'error';

/** An image attached to a chat message (base64 payload, no `data:` prefix). */
export interface ChatImage {
  mediaType: string;
  data: string;
}

/**
 * An ordered renderable slice of an assistant message. Sprint 3 keeps the flat
 * `content` string for the simple consumers (Quick AI, copy, error display) and
 * adds `parts` so the full chat can render reasoning (J3) and tool calls (J1)
 * inline, in stream order.
 */
export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; part: ToolUIPart | DynamicToolUIPart };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Images attached by the user to this message (multimodal input). */
  images?: ChatImage[];
  /** Ordered parts for rich rendering (assistant messages only). */
  parts?: ChatPart[];
  isStreaming?: boolean;
}

/**
 * OpenAI reasoning models accept `reasoning_effort`; chat models (gpt-4o,
 * *-chat-latest) reject it. Other providers stream reasoning via inline
 * `<think>` blocks (handled by the transport middleware), so we only need to
 * request effort here for OpenAI's o-series / GPT-5 reasoning ids.
 */
function reasoningEffortFor(provider: string, model: string | undefined): string | undefined {
  if (provider !== 'openai' || !model) return undefined;
  const isReasoning = /^o\d/.test(model) || (model.startsWith('gpt-5') && !model.includes('chat'));
  return isReasoning ? 'high' : undefined;
}

interface UseAiChatOptions {
  provider: string;
  model?: string;
  /** Custom OpenAI-compatible endpoint for local providers (Ollama / LM Studio). */
  baseUrl?: string;
}

interface AiProfileResponse {
  profile?: string;
  updatedAt?: string;
}

/**
 * Prepend the persisted AI Profile to the per-send system prompt, matching the
 * Rust formatting (`management.rs` legacy path) so the personalization is
 * identical whether the request flows through the proxy or the old command.
 *
 * Injection choice (Sprint 2): the profile is applied in TS rather than in the
 * Rust proxy, keeping `ai_proxy_stream` a transparent relay that never mutates
 * the request body. The profile is user context, not a secret, so TS injection
 * leaks nothing.
 */
function combineSystem(profile: string | null, system: string | undefined): string | undefined {
  const trimmedSystem = system?.trim();
  if (profile && trimmedSystem) return `${profile}\n\n---\n\n${trimmedSystem}`;
  if (profile) return profile;
  return trimmedSystem || undefined;
}

function dataUrlToImage(url: string, mediaType: string): ChatImage | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const data = url.slice(comma + 1);
  if (!data) return null;
  return { mediaType, data };
}

function imageToFilePart(img: ChatImage): FileUIPart {
  return {
    type: 'file',
    mediaType: img.mediaType,
    url: `data:${img.mediaType};base64,${img.data}`,
  };
}

/** Map an AI SDK `UIMessage` (parts[]) to the view-facing `ChatMessage`. */
function uiToChatMessage(msg: UIMessage): ChatMessage | null {
  if (msg.role !== 'user' && msg.role !== 'assistant') return null;
  let content = '';
  const images: ChatImage[] = [];
  const parts: ChatPart[] = [];
  for (const part of msg.parts) {
    if (part.type === 'text') {
      content += part.text;
      parts.push({ kind: 'text', text: part.text });
    } else if (part.type === 'reasoning') {
      parts.push({ kind: 'reasoning', text: part.text });
    } else if (isToolUIPart(part) || isDynamicToolUIPart(part)) {
      parts.push({ kind: 'tool', part });
    } else if (part.type === 'file' && part.mediaType.startsWith('image/')) {
      const img = dataUrlToImage(part.url, part.mediaType);
      if (img) images.push(img);
    }
  }
  return {
    id: msg.id,
    role: msg.role,
    content,
    images: images.length > 0 ? images : undefined,
    parts,
  };
}

export function useAiChat({ provider, model, baseUrl }: UseAiChatOptions) {
  const profileRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<AiProfileResponse>('ai_profile_get')
      .then((p) => {
        if (cancelled) return;
        const trimmed = p?.profile?.trim();
        profileRef.current = trimmed ? trimmed : null;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const transport = useMemo(() => createVoltChatTransport(), []);

  const {
    messages: uiMessages,
    sendMessage,
    status,
    stop: chatStop,
    setMessages,
    clearError,
    error,
  } = useChat({ transport });

  const isStreaming = status === 'submitted' || status === 'streaming';
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const messages = useMemo<ChatMessage[]>(() => {
    const out: ChatMessage[] = [];
    uiMessages.forEach((m, idx) => {
      const cm = uiToChatMessage(m);
      if (!cm) return;
      const isLast = idx === uiMessages.length - 1;
      const hasRichParts = cm.parts?.some((p) => p.kind === 'tool' || p.kind === 'reasoning');
      const isEmptyAssistant =
        cm.role === 'assistant' &&
        !cm.content &&
        (!cm.images || cm.images.length === 0) &&
        !hasRichParts;
      // Drop a blank assistant bubble unless it's the live one still streaming
      // (which renders the "Thinking…" placeholder).
      if (isEmptyAssistant && !(isLast && isStreaming)) return;
      if (cm.role === 'assistant' && isLast && isStreaming) cm.isStreaming = true;
      out.push(cm);
    });
    if (error) {
      out.push({ id: 'chat-error', role: 'error', content: error.message });
    }
    return out;
  }, [uiMessages, isStreaming, error]);

  const send = useCallback(
    (userPrompt: string, systemPrompt?: string, images?: ChatImage[]) => {
      if (!userPrompt.trim() || isStreamingRef.current) return;
      const system = combineSystem(profileRef.current, systemPrompt);
      const files = images && images.length > 0 ? images.map(imageToFilePart) : undefined;
      const reasoningEffort = reasoningEffortFor(provider, model);
      void sendMessage(
        { text: userPrompt, files },
        { body: { provider, model: model ?? '', system, reasoningEffort, baseUrl } }
      );
    },
    [sendMessage, provider, model, baseUrl]
  );

  const clear = useCallback(() => {
    void chatStop();
    cancelAllToolApprovals();
    setMessages([]);
    clearError();
  }, [chatStop, setMessages, clearError]);

  const stop = useCallback(() => {
    void chatStop();
  }, [chatStop]);

  return { messages, isStreaming, send, clear, stop };
}
