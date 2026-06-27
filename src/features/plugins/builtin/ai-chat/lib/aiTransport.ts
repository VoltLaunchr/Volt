import { Channel, invoke } from '@tauri-apps/api/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  convertToModelMessages,
  extractReasoningMiddleware,
  stepCountIs,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { createVoltTools } from './aiTools';

/**
 * Sprint 2 — Pari A3. The chat orchestration runs in the renderer via the
 * Vercel AI SDK, but the API key stays in the Rust OS keyring. We bridge the two
 * with a custom `fetch`: the AI SDK builds the OpenAI `chat/completions` request,
 * `voltFetch` forwards the body to the `ai_proxy_stream` Tauri command over a
 * `Channel`, and Rust injects the key + re-streams the raw SSE bytes back. The
 * renderer rebuilds a streamed `Response` the SDK parses natively.
 *
 * Sprint 3 — J1/J2/J3. `createVoltModel` now wraps the provider model with the
 * reasoning-extraction middleware (J3) and flags structured-output support (J2),
 * and the transport runs a bounded tool-loop (`tools` + `stopWhen`) so the model
 * can act on Volt (J1). All of this lives client-side in the AI SDK; Rust stays a
 * transparent secret-injecting relay.
 */

/** Mirror of the Rust `AiProxyEvent` enum (`commands/ai/proxy.rs`). */
type AiProxyEvent =
  | { type: 'chunk'; data: string }
  | { type: 'done' }
  | { type: 'error'; error: string; status?: number };

/**
 * The provider `baseURL` is only cosmetic here — `voltFetch` ignores the URL and
 * Rust resolves the authoritative endpoint per provider. We still pass a valid,
 * obviously-fake URL so the SDK's URL builder never throws.
 */
const PROXY_PLACEHOLDER_BASE_URL = 'https://ai-proxy.volt.invalid/v1';

/** Upper bound on the model→tool→model loop, to cap latency and API cost. */
const MAX_TOOL_STEPS = 6;

/** Tools are stateless (apart from the shared approval store) — build once. */
const VOLT_TOOLS = createVoltTools();

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Run `fn`, swallowing the throw if the stream consumer already tore down the
 * controller (cancel/abort makes enqueue/close/error throw). */
function withController(fn: () => void): void {
  try {
    fn();
  } catch {
    // Consumer cancelled the stream — the controller is no longer writable.
  }
}

/**
 * Build a `fetch` that the AI SDK provider uses for `POST {baseURL}/chat/completions`.
 * It forwards the JSON body to Rust and reconstructs a streamed SSE `Response`.
 */
function makeVoltFetch(provider: string, baseUrl?: string): typeof globalThis.fetch {
  return (_input, init) => {
    const requestBody: unknown =
      typeof init?.body === 'string' ? JSON.parse(init.body) : {};

    const stream = new globalThis.ReadableStream<Uint8Array>({
      start(controller) {
        let settled = false;

        const channel = new Channel<AiProxyEvent>();
        channel.onmessage = (event) => {
          if (settled) return;
          if (event.type === 'chunk') {
            withController(() => controller.enqueue(base64ToBytes(event.data)));
          } else if (event.type === 'done') {
            settled = true;
            withController(() => controller.close());
          } else if (event.type === 'error') {
            settled = true;
            withController(() => controller.error(new Error(event.error)));
          }
        };

        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            settled = true;
            withController(() => controller.close());
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              if (settled) return;
              settled = true;
              withController(() => controller.close());
            },
            { once: true }
          );
        }

        invoke('ai_proxy_stream', { provider, requestBody, baseUrl, channel }).catch((err: unknown) => {
          if (settled) return;
          settled = true;
          withController(() =>
            controller.error(err instanceof Error ? err : new Error(String(err)))
          );
        });
      },
    });

    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
  };
}

interface VoltModelOptions {
  /**
   * OpenAI-style reasoning effort (`'low' | 'medium' | 'high'`). When set it is
   * injected as `reasoning_effort` into the request body. Only pass this for
   * reasoning-capable models (o-series / GPT-5 reasoning) — chat models reject
   * the field.
   */
  reasoningEffort?: string;
  /**
   * Custom OpenAI-compatible endpoint for local providers (Ollama / LM Studio).
   * Forwarded to the Rust proxy as `base_url`; when set, the proxy issues a
   * keyless request to that endpoint (Pari B).
   */
  baseUrl?: string;
}

/**
 * Build the language model the AI SDK drives: an OpenAI-compatible model pointed
 * at the keyring-backed proxy, wrapped so that inline `<think>` blocks (DeepSeek
 * R1, Qwen Thinking, GLM, …) surface as native reasoning parts (J3). Structured
 * outputs are enabled at the provider level so `streamObject` can emit a
 * `response_format: json_schema` body (J2).
 *
 * Shared by the chat transport and the structured-output helper so both speak to
 * the proxy identically.
 */
export function createVoltModel(
  provider: string,
  model: string,
  options: VoltModelOptions = {}
): LanguageModel {
  const { reasoningEffort, baseUrl } = options;
  const openaiCompatible = createOpenAICompatible({
    name: `volt-${provider}`,
    baseURL: PROXY_PLACEHOLDER_BASE_URL,
    fetch: makeVoltFetch(provider, baseUrl),
    supportsStructuredOutputs: true,
    transformRequestBody: reasoningEffort
      ? (body: Record<string, unknown>) => ({ ...body, reasoning_effort: reasoningEffort })
      : undefined,
  });
  return wrapLanguageModel({
    model: openaiCompatible(model),
    middleware: extractReasoningMiddleware({ tagName: 'think' }),
  });
}

/** The per-send config the hook ships through `sendMessage(..., { body })`. */
interface VoltSendBody {
  provider: string;
  model: string;
  system?: string;
  reasoningEffort?: string;
  baseUrl?: string;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** Extract `{ provider, model, system, reasoningEffort }` from the request body. */
function extractSendBody(body: ChatRequestOptions['body']): VoltSendBody {
  if (!body || typeof body !== 'object') {
    throw new Error('Volt AI transport: missing request body (provider/model).');
  }
  const record = body as Record<string, unknown>;
  const provider = readString(record, 'provider');
  const model = readString(record, 'model');
  if (!provider || !model) {
    throw new Error('Volt AI transport: provider and model are required.');
  }
  const system = readString(record, 'system');
  return {
    provider,
    model,
    system: system && system.trim().length > 0 ? system : undefined,
    reasoningEffort: readString(record, 'reasoningEffort'),
    baseUrl: readString(record, 'baseUrl'),
  };
}

/**
 * A stateless `ChatTransport` that runs `streamText` client-side against the
 * keyring-backed proxy. Provider/model/system are read from each send's `body`
 * (see `useAiChat`), so the transport object stays stable across UI provider and
 * model switches — `useChat` keeps the same conversation instead of resetting it.
 *
 * The tool-loop (J1) is bounded by `stopWhen: stepCountIs(MAX_TOOL_STEPS)`; each
 * loop step is one proxied request. Tool parts and reasoning parts flow back to
 * the UI through `toUIMessageStream` (`sendReasoning` defaults to true).
 */
export function createVoltChatTransport(): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal, body }): Promise<ReadableStream<UIMessageChunk>> {
      const { provider, model, system, reasoningEffort, baseUrl } = extractSendBody(body);
      const result = streamText({
        model: createVoltModel(provider, model, { reasoningEffort, baseUrl }),
        system,
        messages: await convertToModelMessages(messages),
        tools: VOLT_TOOLS,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        abortSignal,
      });
      return toUIMessageStream({ stream: result.fullStream, tools: VOLT_TOOLS });
    },
    reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
      return Promise.resolve(null);
    },
  };
}
