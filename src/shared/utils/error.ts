/** Shape of a serialized VoltError from the Rust backend. */
interface VoltErrorPayload {
  kind: string;
  message: string;
}

function isVoltErrorPayload(v: unknown): v is VoltErrorPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    'kind' in v &&
    'message' in v &&
    typeof (v as VoltErrorPayload).message === 'string'
  );
}

/**
 * Extract a human-readable message from any thrown value.
 *
 * Handles:
 * - Standard `Error` instances
 * - Serialized `VoltError` objects `{ kind, message }` thrown by Tauri invoke
 * - Plain strings
 * - Anything else → JSON or fallback
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isVoltErrorPayload(err)) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
