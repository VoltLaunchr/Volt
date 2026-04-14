/* global Worker, MessageEvent, RequestInit, fetch, ErrorEvent, Blob, URL */
/**
 * Worker Sandbox
 *
 * WorkerPlugin is a proxy that implements the Plugin interface
 * but runs extension code in a dedicated Web Worker. Communication
 * happens via postMessage with a 500ms timeout.
 */

import { Plugin, PluginContext, PluginResult } from '../../plugins/types';
import { copyToClipboard, openUrl } from '../../plugins/utils/helpers';
import { generateWorkerBootstrap, type ActionCommand, type WorkerResponse } from './worker-bootstrap';
import { logger } from '../../../shared/utils/logger';

const WORKER_TIMEOUT_MS = 500;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A Plugin implementation that delegates match() and execute() to a Web Worker.
 * canHandle() is evaluated declaratively on the main thread using keywords/prefix.
 */
export class WorkerPlugin implements Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;

  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private workerCode: string;
  private blobUrl: string | null = null;

  // Declarative canHandle config
  private keywords: string[];
  private prefix: string | null;

  // Permission enforcement
  private grantedPermissions: Set<string>;

  constructor(options: {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    prefix: string | null;
    bundledModuleCode: string;
    entryPoint: string;
    grantedPermissions: string[];
  }) {
    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.enabled = true;
    this.keywords = options.keywords.map((k) => k.toLowerCase());
    this.prefix = options.prefix?.toLowerCase() ?? null;
    this.workerCode = generateWorkerBootstrap(options.bundledModuleCode, options.entryPoint);
    this.grantedPermissions = new Set(options.grantedPermissions);
  }

  /**
   * Check if a permission is granted for this extension.
   */
  private hasPermission(permission: string): boolean {
    return this.grantedPermissions.has(permission);
  }

  /**
   * Declarative canHandle — no extension code executed.
   * Evaluated on main thread using keywords/prefix from manifest.
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.toLowerCase().trim();
    if (!query) return false;

    if (this.prefix) {
      return query.startsWith(this.prefix);
    }

    if (this.keywords.length > 0) {
      return this.keywords.some(
        (kw) => query.startsWith(kw) || query === kw
      );
    }

    // No keywords or prefix → generic extension, receives all queries
    return true;
  }

  /**
   * Sends match request to Worker, returns results with 500ms timeout.
   */
  async match(context: PluginContext): Promise<PluginResult[]> {
    try {
      const worker = this.getOrCreateWorker();
      const results = await this.sendRequest<PluginResult[]>(worker, 'match', {
        query: context.query,
      });
      // Tag results with pluginId
      return (results || []).map((r) => ({ ...r, pluginId: this.id }));
    } catch (err) {
      logger.error(`[WorkerPlugin:${this.id}] match() failed:`, err);
      return [];
    }
  }

  /**
   * Sends execute request to Worker, receives action commands and runs them.
   */
  async execute(result: PluginResult): Promise<void> {
    try {
      const worker = this.getOrCreateWorker();
      const actions = await this.sendRequest<ActionCommand[]>(worker, 'execute', result);
      if (actions) {
        await this.executeActions(actions);
      }
    } catch (err) {
      logger.error(`[WorkerPlugin:${this.id}] execute() failed:`, err);
    }
  }

  /**
   * Send a typed request to the Worker and wait for response with timeout.
   */
  private sendRequest<T>(worker: Worker, type: 'match' | 'execute', payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.requestId;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.terminateWorker();
        reject(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS}ms for ${type}`));
      }, WORKER_TIMEOUT_MS);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      worker.postMessage({ type, id, payload });
    });
  }

  /**
   * Handle messages from the Worker.
   */
  private handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const { type, id, payload } = event.data;

    // Ignore 'ready' signal
    if (type === 'ready' as string) return;

    // Handle fetch requests from Worker
    if (type === 'fetch-request' as string) {
      this.handleFetchRequest(id, payload as { url: string; options?: RequestInit });
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (type === 'error') {
      pending.reject(new Error(String(payload)));
    } else {
      pending.resolve(payload);
    }
  };

  /**
   * Handle fetch requests from the Worker.
   * Executes fetch on the main thread (where network is available) and sends response back.
   */
  private async handleFetchRequest(
    requestId: number,
    payload: { url: string; options?: RequestInit }
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    if (!this.hasPermission('network')) {
      console.warn(`[WorkerPlugin:${this.id}] Blocked fetch — network permission not granted`);
      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: { error: 'Network permission not granted' },
      });
      return;
    }

    try {
      const response = await fetch(payload.url, payload.options);
      const text = await response.text();
      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: text,
        },
      });
    } catch (err) {
      worker.postMessage({
        type: 'fetch-response',
        id: requestId,
        payload: { error: String(err) },
      });
    }
  }

  /**
   * Handle Worker errors.
   */
  private handleError = (event: ErrorEvent) => {
    logger.error(`[WorkerPlugin:${this.id}] Worker error:`, event.message);
    // Reject all pending requests
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Worker error: ${event.message}`));
    }
    this.pending.clear();
    this.terminateWorker();
  };

  /**
   * Get existing Worker or create a new one (lazy initialization).
   */
  private getOrCreateWorker(): Worker {
    if (this.worker) return this.worker;

    const blob = new Blob([this.workerCode], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.blobUrl);
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;

    return this.worker;
  }

  /**
   * Terminate the Worker and clean up resources.
   */
  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  /**
   * Execute action commands returned by the Worker.
   */
  private async executeActions(actions: ActionCommand[]): Promise<void> {
    for (const action of actions) {
      switch (action.action) {
        case 'copyToClipboard':
          if (!this.hasPermission('clipboard')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked clipboard access — permission not granted`);
            break;
          }
          await copyToClipboard(action.text);
          break;
        case 'openUrl':
          await openUrl(action.url);
          break;
        case 'fetch': {
          if (!this.hasPermission('network')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked network access — permission not granted`);
            break;
          }
          // Network fetch is handled in match/execute response flow, not here
          break;
        }
        case 'notify':
          if (!this.hasPermission('notifications')) {
            console.warn(`[WorkerPlugin:${this.id}] Blocked notification — permission not granted`);
            break;
          }
          window.dispatchEvent(
            new CustomEvent('volt:notification', {
              detail: { message: action.message, type: action.type || 'info' },
            })
          );
          break;
        case 'noop':
          break;
      }
    }
  }

  /**
   * Clean up resources when the plugin is unloaded.
   */
  destroy(): void {
    // Reject all pending requests
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Plugin destroyed'));
    }
    this.pending.clear();
    this.terminateWorker();
  }
}
