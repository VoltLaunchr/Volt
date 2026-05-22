import { Channel, invoke } from '@tauri-apps/api/core';
import { useCallback, useRef, useState } from 'react';

export type ChatRole = 'user' | 'assistant' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  isStreaming?: boolean;
}

type AiStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; fullText: string }
  | { type: 'error'; error: string };

interface UseAiChatOptions {
  provider: string;
  model?: string;
}

export function useAiChat({ provider, model }: UseAiChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // Ref-based guard to avoid stale closures in async callbacks
  const isStreamingRef = useRef(false);
  const abortRef = useRef(false);

  const send = useCallback(
    async (userPrompt: string, systemPrompt?: string) => {
      if (!userPrompt.trim() || isStreamingRef.current) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userPrompt,
      };
      const assistantId = `asst-${Date.now() + 1}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      isStreamingRef.current = true;
      setIsStreaming(true);
      abortRef.current = false;

      let gotFinalEvent = false;

      const finalize = (finalContent: string, role: ChatRole = 'assistant') => {
        gotFinalEvent = true;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: finalContent, isStreaming: false, role } : m
          )
        );
        isStreamingRef.current = false;
        setIsStreaming(false);
      };

      try {
        const channel = new Channel<AiStreamEvent>();

        channel.onmessage = (event) => {
          if (abortRef.current) return;
          if (event.type === 'chunk') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + event.text } : m
              )
            );
          } else if (event.type === 'done') {
            finalize(event.fullText, 'assistant');
          } else if (event.type === 'error') {
            finalize(event.error, 'error');
          }
        };

        await invoke('ai_ask_builtin_stream', {
          provider,
          prompt: userPrompt,
          options: {
            model: model ?? undefined,
            system: systemPrompt ?? undefined,
          },
          channel,
        });

        // Safety: if stream ended without a terminal event
        if (!gotFinalEvent && !abortRef.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
          );
          isStreamingRef.current = false;
          setIsStreaming(false);
        }
      } catch (err) {
        if (!gotFinalEvent && !abortRef.current) {
          finalize(String(err), 'error');
        }
      }
    },
    // setIsStreaming and refs are stable; provider/model are real deps
    [provider, model]
  );

  const clear = useCallback(() => {
    abortRef.current = true;
    isStreamingRef.current = false;
    setMessages([]);
    setIsStreaming(false);
  }, []);

  /**
   * Abort the in-flight stream without clearing the conversation. The current
   * partial assistant message is kept and marked done; later events are
   * suppressed via `abortRef`.
   */
  const stop = useCallback(() => {
    if (!isStreamingRef.current) return;
    abortRef.current = true;
    isStreamingRef.current = false;
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  }, []);

  return { messages, isStreaming, send, clear, stop };
}
