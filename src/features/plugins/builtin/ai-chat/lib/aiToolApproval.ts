/**
 * Sprint 3 — J1. Human-in-the-loop approval for side-effecting AI tools.
 *
 * Architecture note: the chat tool-loop runs client-side inside the AI SDK
 * transport (`createVoltModel` + `streamText`), so each tool's `execute` runs in
 * the renderer. AI SDK 7 also ships a native `toolApproval: 'user-approval'`
 * flow, but it assumes a server/client split that suspends and resumes the run
 * across requests — our custom IPC transport runs `streamText` one-shot per
 * `sendMessages`, so that round-trip does not map cleanly. We therefore gate the
 * side effect *inside* `execute`: it awaits this store, which surfaces a
 * confirmation card in the UI, and only calls `invoke` once the user approves.
 *
 * This module is a tiny framework-agnostic external store so the (non-React)
 * tool code can request approval and the React view can render it via
 * `useSyncExternalStore`. Requests are serialized: at most one is pending.
 */

export interface ToolApprovalRequest {
  /** Monotonic id; identifies the request when the user responds. */
  id: number;
  /** Runtime tool name (e.g. `launch_application`). */
  toolName: string;
  /** Short human-readable action title for the card header. */
  title: string;
  /** One-line description of exactly what will happen if approved. */
  summary: string;
  /** The raw tool input, shown as the technical detail. */
  input: unknown;
}

type Listener = () => void;

interface PendingEntry {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

let nextId = 1;
let current: PendingEntry | null = null;
const queue: PendingEntry[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function advance(): void {
  current = queue.shift() ?? null;
  emit();
}

/**
 * Ask the user to approve a side effect. Resolves `true` if approved, `false`
 * if denied (or if the conversation is cleared while the request is pending).
 */
export function requestToolApproval(req: Omit<ToolApprovalRequest, 'id'>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const entry: PendingEntry = { request: { ...req, id: nextId++ }, resolve };
    queue.push(entry);
    if (current === null) advance();
  });
}

/** Resolve the currently-pending request. No-op if the id no longer matches. */
export function respondToolApproval(id: number, approved: boolean): void {
  if (!current || current.request.id !== id) return;
  current.resolve(approved);
  advance();
}

/** Deny every pending/queued request — used when the conversation is reset. */
export function cancelAllToolApprovals(): void {
  const drained = current ? [current, ...queue] : [...queue];
  current = null;
  queue.length = 0;
  for (const entry of drained) entry.resolve(false);
  if (drained.length > 0) emit();
}

/** Snapshot for `useSyncExternalStore` — stable reference until it changes. */
export function getPendingApproval(): ToolApprovalRequest | null {
  return current?.request ?? null;
}

export function subscribeToolApprovals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
