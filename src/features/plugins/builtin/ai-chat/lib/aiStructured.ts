/**
 * Sprint 3 — J2. Reusable structured-output entry point.
 *
 * Returns a typed, schema-validated object from a model, routed through the same
 * keyring-backed proxy as the chat (`createVoltModel`). The provider is created
 * with `supportsStructuredOutputs: true`, so the request carries a
 * `response_format: { type: 'json_schema', … }` body.
 *
 * Why `streamObject` and not `generateObject`: the Rust proxy (`ai_proxy_stream`)
 * always forces `stream: true` and re-streams SSE — it is a streaming-only
 * relay. `generateObject` issues a non-streaming `doGenerate` call and would
 * mis-parse the SSE body, so we use `streamObject` (which uses `doStream`) and
 * await the final validated object. The streaming is internal; callers get a
 * single resolved object.
 *
 * There is no in-app consumer wired yet (presets/quick actions stay free-text
 * for now); this is the clean reusable primitive plus a worked example. Wire a
 * preset to it by passing a `jsonSchema<T>(…)` describing the expected shape.
 *
 * @example
 * ```ts
 * import { jsonSchema } from 'ai';
 * import { generateVoltObject } from './aiStructured';
 *
 * const result = await generateVoltObject({
 *   provider: 'openai',
 *   model: 'gpt-5.4-mini',
 *   schema: jsonSchema<{ title: string; tags: string[] }>({
 *     type: 'object',
 *     additionalProperties: false,
 *     properties: {
 *       title: { type: 'string' },
 *       tags: { type: 'array', items: { type: 'string' } },
 *     },
 *     required: ['title', 'tags'],
 *   }),
 *   system: 'You extract structured metadata from notes.',
 *   prompt: noteText,
 * });
 * // result.title / result.tags are fully typed.
 * ```
 */

import { streamObject, type Schema } from 'ai';
import { createVoltModel } from './aiTransport';

export interface GenerateVoltObjectParams<T> {
  provider: string;
  model: string;
  /** Build with `jsonSchema<T>(…)` (or a zod schema) from `ai`. */
  schema: Schema<T>;
  prompt: string;
  system?: string;
  abortSignal?: AbortSignal;
}

export async function generateVoltObject<T>(params: GenerateVoltObjectParams<T>): Promise<T> {
  const { provider, model, schema, prompt, system, abortSignal } = params;
  const result = streamObject({
    model: createVoltModel(provider, model),
    schema,
    system,
    prompt,
    abortSignal,
  });
  // Drain the partial stream so the underlying request is pulled to completion,
  // then return the validated final object.
  for await (const _partial of result.partialObjectStream) {
    // Intentionally ignored — we only need the final object here.
  }
  return result.object;
}
