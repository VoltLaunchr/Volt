/**
 * Shell Command Plugin — execute shell commands inline with `>` prefix
 *
 * Trigger: `>` prefix (e.g., `>git status`, `>ls -la`)
 * Shows command ready to run, executes on Enter, displays output inline.
 *
 * Security notes (post-audit):
 *  - The command blocklist below is duplicated on the Rust side. Treat it as
 *    UX polish, not a trust boundary: the backend is authoritative. See
 *    `src-tauri/src/commands/shell.rs::BLOCKED_PATTERNS`.
 *  - History recording is driven by the backend. This module no longer calls
 *    `record_shell_command` — the backend writes to history directly when a
 *    child exits, preventing a malicious caller from fabricating history
 *    entries for commands that were never run.
 *  - The output cache is keyed by `executionId`, not by the raw command
 *    string, so concurrent runs of the same command no longer clobber each
 *    other mid-flight.
 */

import { invoke, Channel } from '@tauri-apps/api/core';
import type { Plugin, PluginContext, PluginResult } from '../../types';
import { PluginResultType } from '../../types';
import { logger } from '../../../../shared/utils/logger';
import type { Settings } from '../../../settings/types/settings.types';

// ── Dangerous command validation ──────────────────────────────────────────────

/**
 * Commands/patterns that are blocked because they can cause irreversible damage.
 * Each entry is tested against the normalised (trimmed, lower-cased) command.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-\w*)?r\w*\s+(-\w*\s+)*\//,
  /\brm\s+(-\w*)?r\w*\s+(-\w*\s+)*[A-Z]:\\/i,
  /\bformat\s+[A-Z]:/i,
  /\bmkfs\b/,
  /\bdd\s+.*\bof=\//,

  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+0\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,

  /:\(\)\{.*\}.*;/,
  /\bwhile\s+true.*do.*done/,

  /\breg\s+delete\s+hk/i,
  /\bwevtutil\s+cl\b/i,
];

const BLOCK_MESSAGE =
  'This command is blocked for safety. It could cause irreversible damage to your system.';

/**
 * Returns true if the command should be blocked.
 * Exported for testing.
 */
export function isCommandBlocked(command: string): boolean {
  const normalised = command.trim().toLowerCase();
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(normalised));
}

// ── Cache limits ──────────────────────────────────────────────────────────────

const OUTPUT_CACHE_MAX = 50;
const OUTPUT_CACHE_MAX_CHARS = 512_000;

/**
 * Safety timer: if invoke() for the streaming command resolves but no
 * terminal Channel event (exit/error/timedOut) lands within this window,
 * finalize the UI anyway. Guards against a dead channel leaving the inner
 * Promise hanging forever.
 */
const STREAMING_DRAIN_MS = 1_500;

/**
 * Fallback timeout when the user has not configured one. Matches the Rust
 * default so UI and backend stay in sync in the absence of a settings read.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

type ShellOutputEvent =
  | { event: 'stdout'; data: { line: string } }
  | { event: 'stderr'; data: { line: string } }
  | { event: 'exit'; data: { code: number; executionTimeMs: number } }
  | { event: 'error'; data: { message: string } }
  | { event: 'timedOut'; data: { executionTimeMs: number } };

interface ShellCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  timedOut: boolean;
}

interface ShellHistoryRecord {
  command: string;
  runCount: number;
  lastRun: number;
  firstRun: number;
  lastExitCode: number;
  lastWorkingDir: string | null;
  pinned: boolean;
}

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface ShellOutputData {
  command: string;
  status: 'pending' | 'running' | 'done' | 'error';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  executionTimeMs?: number;
  timedOut?: boolean;
  errorMessage?: string;
  executionId?: string;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

let executionCounter = 0;

export class ShellCommandPlugin implements Plugin {
  id = 'shellcommand';
  name = 'Shell Command';
  description = 'Run shell commands inline with > prefix';
  enabled = true;

  /**
   * Output cache keyed by `executionId`. The previous implementation keyed
   * by the raw command string, which let two concurrent runs of the same
   * command silently clobber each other's streaming state. With an id-based
   * key every execution owns its own entry; lookups from `match()` simply
   * scan most-recent-first for a matching command.
   */
  private outputCache = new Map<string, ShellOutputData>();

  /** Cached shell settings. Populated lazily on first access and refreshed
   *  on every execute so a user toggling `shell.enabled` off is respected
   *  without app restart. */
  private cachedSettings: Settings['shell'] | null = null;
  private settingsLastLoaded = 0;
  private readonly SETTINGS_TTL_MS = 5_000;

  private async getShellSettings(): Promise<Settings['shell'] | null> {
    const now = Date.now();
    if (this.cachedSettings && now - this.settingsLastLoaded < this.SETTINGS_TTL_MS) {
      return this.cachedSettings;
    }
    try {
      const settings = await invoke<Settings>('load_settings');
      this.cachedSettings = settings.shell ?? null;
      this.settingsLastLoaded = now;
      return this.cachedSettings;
    } catch (err) {
      logger.warn('Shell: failed to load settings', err);
      return this.cachedSettings;
    }
  }

  canHandle(context: PluginContext): boolean {
    return context.query.startsWith('>');
  }

  /** Find the most recent cached entry for a command (reverse insertion order). */
  private findCachedByCommand(command: string): ShellOutputData | undefined {
    const entries = [...this.outputCache.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
      const data = entries[i][1];
      if (data.command === command) return data;
    }
    return undefined;
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const raw = context.query.substring(1).trim();

    this.evictCache();

    if (raw === '!!' || raw === '! !') {
      try {
        const history = await invoke<ShellHistoryRecord[]>('get_shell_suggestions', {
          prefix: '',
          limit: 1,
        });
        if (history.length > 0) {
          const last = history[0];
          return [
            {
              id: 'shell-rerun-last',
              type: PluginResultType.ShellCommand,
              title: last.command,
              subtitle: `Re-run last command (${formatRelativeTime(last.lastRun)})`,
              badge: 'Shell',
              score: 100,
              pluginId: this.id,
              data: { command: last.command, status: 'pending' } as unknown as Record<
                string,
                unknown
              >,
            },
          ];
        }
      } catch (err) {
        logger.warn('Shell: failed to fetch history for re-run', err);
      }
      return [
        {
          id: 'shell-no-history',
          type: PluginResultType.ShellCommand,
          title: '!!',
          subtitle: 'No command history yet',
          badge: 'Shell',
          score: 100,
          pluginId: this.id,
          data: { command: '', status: 'pending' } as unknown as Record<string, unknown>,
        },
      ];
    }

    if (raw.startsWith('!') && raw.length > 1) {
      const searchPrefix = raw.substring(1);
      try {
        const history = await invoke<ShellHistoryRecord[]>('get_shell_suggestions', {
          prefix: searchPrefix,
          limit: 5,
        });
        if (history.length > 0) {
          return history.map((record, i) => ({
            id: `shell-bang-${record.command}`,
            type: PluginResultType.ShellCommand,
            title: record.command,
            subtitle: `Ran ${record.runCount}x · last ${formatRelativeTime(record.lastRun)}`,
            badge: record.runCount > 1 ? `×${record.runCount}` : 'Shell',
            score: 100 - i,
            pluginId: this.id,
            data: { command: record.command, status: 'pending' } as unknown as Record<
              string,
              unknown
            >,
          }));
        }
      } catch (err) {
        logger.warn('Shell: failed to fetch bang history', err);
      }
    }

    if (!raw) {
      try {
        const history = await invoke<ShellHistoryRecord[]>('get_shell_suggestions', {
          prefix: '',
          limit: 5,
        });
        if (history.length > 0) {
          return history.map((record, i) => ({
            id: `shell-history-${record.command}`,
            type: PluginResultType.ShellCommand,
            title: record.command,
            subtitle: `Ran ${record.runCount}x · last ${formatRelativeTime(record.lastRun)}${record.pinned ? ' · \ud83d\udccc' : ''}`,
            badge: 'Shell',
            score: 100 - i,
            pluginId: this.id,
            data: { command: record.command, status: 'pending' } as unknown as Record<
              string,
              unknown
            >,
          }));
        }
      } catch (err) {
        logger.warn('Shell: failed to fetch recent history', err);
      }
      return [
        {
          id: 'shell-hint',
          type: PluginResultType.ShellCommand,
          title: 'Shell Command Mode',
          subtitle: 'Type a command after > (e.g. >git status)',
          badge: 'Shell',
          score: 100,
          pluginId: this.id,
          data: { command: '', status: 'pending' } satisfies ShellOutputData,
        },
      ];
    }

    const cached = this.findCachedByCommand(raw);
    const data: ShellOutputData =
      cached && cached.command === raw ? cached : { command: raw, status: 'pending' };

    const results: PluginResult[] = [
      {
        id: `shell-${raw}`,
        type: PluginResultType.ShellCommand,
        title: raw,
        subtitle: data.status === 'pending' ? 'Press Enter to run' : undefined,
        badge: 'Shell',
        score: 100,
        pluginId: this.id,
        data: data as unknown as Record<string, unknown>,
      },
    ];

    try {
      const history = await invoke<ShellHistoryRecord[]>('get_shell_suggestions', {
        prefix: raw,
        limit: 3,
      });
      for (let i = 0; i < history.length; i++) {
        const record = history[i];
        if (record.command === raw) continue;
        results.push({
          id: `shell-history-${record.command}`,
          type: PluginResultType.ShellCommand,
          title: record.command,
          subtitle: `Ran ${record.runCount}x · last ${formatRelativeTime(record.lastRun)}${record.pinned ? ' · \ud83d\udccc' : ''}`,
          badge: 'Shell',
          score: 90 - i,
          pluginId: this.id,
          data: { command: record.command, status: 'pending' } as unknown as Record<
            string,
            unknown
          >,
        });
      }
    } catch (err) {
      logger.warn('Shell: failed to fetch history suggestions', err);
    }

    return results;
  }

  private evictCache(): void {
    if (this.outputCache.size > OUTPUT_CACHE_MAX) {
      const keys = [...this.outputCache.keys()];
      const toRemove = keys.length - OUTPUT_CACHE_MAX;
      for (let i = 0; i < toRemove; i++) {
        this.outputCache.delete(keys[i]);
      }
    }

    let totalChars = 0;
    for (const entry of this.outputCache.values()) {
      totalChars += (entry.stdout?.length ?? 0) + (entry.stderr?.length ?? 0);
    }
    if (totalChars > OUTPUT_CACHE_MAX_CHARS) {
      const keys = [...this.outputCache.keys()];
      for (const key of keys) {
        if (totalChars <= OUTPUT_CACHE_MAX_CHARS) break;
        const entry = this.outputCache.get(key);
        if (entry) {
          totalChars -= (entry.stdout?.length ?? 0) + (entry.stderr?.length ?? 0);
          this.outputCache.delete(key);
        }
      }
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const data = result.data as unknown as ShellOutputData;
    if (!data?.command) return;

    const command = data.command;

    if (isCommandBlocked(command)) {
      const blockedData: ShellOutputData = {
        command,
        status: 'error',
        errorMessage: BLOCK_MESSAGE,
      };
      const blockedId = `shell-blocked-${Date.now()}`;
      this.outputCache.set(blockedId, blockedData);
      window.dispatchEvent(
        new CustomEvent('volt:shell-output', { detail: { command, data: blockedData } }),
      );
      return;
    }

    const executionId = `shell-${++executionCounter}-${Date.now()}`;
    const shellSettings = await this.getShellSettings();
    const timeoutMs = shellSettings?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const runningData: ShellOutputData = { command, status: 'running', executionId };
    this.outputCache.set(executionId, runningData);
    window.dispatchEvent(
      new CustomEvent('volt:shell-output', { detail: { command, data: runningData } }),
    );

    try {
      await this.executeStreaming(command, executionId, timeoutMs);
    } catch {
      // Fallback to non-streaming if streaming is unavailable
      try {
        const output = await invoke<ShellCommandOutput>('execute_shell_command', {
          options: { command, timeoutMs },
          executionId,
        });

        const doneData: ShellOutputData = {
          command,
          status: 'done',
          stdout: output.stdout,
          stderr: output.stderr,
          exitCode: output.exitCode,
          executionTimeMs: output.executionTimeMs,
          timedOut: output.timedOut,
          executionId,
        };
        this.outputCache.set(executionId, doneData);
        window.dispatchEvent(
          new CustomEvent('volt:shell-output', { detail: { command, data: doneData } }),
        );
      } catch (err) {
        const errorData: ShellOutputData = {
          command,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
          executionId,
        };
        this.outputCache.set(executionId, errorData);
        window.dispatchEvent(
          new CustomEvent('volt:shell-output', { detail: { command, data: errorData } }),
        );
      }
    }
  }

  private async executeStreaming(
    command: string,
    executionId: string,
    timeoutMs: number,
  ): Promise<void> {
    let stdout = '';
    let stderr = '';

    const channel = new Channel<ShellOutputEvent>();
    let terminal = false;
    let resolved = false;

    return new Promise<void>((resolve, reject) => {
      const finalize = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      channel.onmessage = (event: ShellOutputEvent) => {
        switch (event.event) {
          case 'stdout': {
            stdout += (stdout ? '\n' : '') + event.data.line;
            const runningData: ShellOutputData = {
              command,
              status: 'running',
              stdout,
              executionId,
            };
            this.outputCache.set(executionId, runningData);
            window.dispatchEvent(
              new CustomEvent('volt:shell-output', { detail: { command, data: runningData } }),
            );
            break;
          }
          case 'stderr': {
            stderr += (stderr ? '\n' : '') + event.data.line;
            const runningStderr: ShellOutputData = {
              command,
              status: 'running',
              stdout,
              stderr,
              executionId,
            };
            this.outputCache.set(executionId, runningStderr);
            window.dispatchEvent(
              new CustomEvent('volt:shell-output', {
                detail: { command, data: runningStderr },
              }),
            );
            break;
          }
          case 'exit': {
            terminal = true;
            const doneData: ShellOutputData = {
              command,
              status: 'done',
              stdout,
              stderr,
              exitCode: event.data.code,
              executionTimeMs: event.data.executionTimeMs,
              executionId,
            };
            this.outputCache.set(executionId, doneData);
            window.dispatchEvent(
              new CustomEvent('volt:shell-output', { detail: { command, data: doneData } }),
            );
            finalize();
            break;
          }
          case 'error': {
            terminal = true;
            const errorData: ShellOutputData = {
              command,
              status: 'error',
              stdout,
              stderr,
              errorMessage: event.data.message,
              executionId,
            };
            this.outputCache.set(executionId, errorData);
            window.dispatchEvent(
              new CustomEvent('volt:shell-output', { detail: { command, data: errorData } }),
            );
            finalize();
            break;
          }
          case 'timedOut': {
            terminal = true;
            const timedOutData: ShellOutputData = {
              command,
              status: 'done',
              stdout,
              stderr,
              timedOut: true,
              executionTimeMs: event.data.executionTimeMs,
              executionId,
            };
            this.outputCache.set(executionId, timedOutData);
            window.dispatchEvent(
              new CustomEvent('volt:shell-output', {
                detail: { command, data: timedOutData },
              }),
            );
            finalize();
            break;
          }
        }
      };

      invoke('execute_shell_command_streaming', {
        command,
        timeoutMs,
        workingDir: null,
        executionId,
        onEvent: channel,
      })
        .then(() => {
          // Backend has returned. If we saw a terminal event, we're done.
          // Otherwise wait briefly for any in-flight Channel message to
          // arrive, then finalize so the UI doesn't hang forever.
          if (terminal) return;
          setTimeout(() => {
            if (!terminal && !resolved) {
              const fallbackData: ShellOutputData = {
                command,
                status: 'done',
                stdout,
                stderr,
                executionId,
              };
              this.outputCache.set(executionId, fallbackData);
              window.dispatchEvent(
                new CustomEvent('volt:shell-output', {
                  detail: { command, data: fallbackData },
                }),
              );
              finalize();
            }
          }, STREAMING_DRAIN_MS);
        })
        .catch((err) => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
    });
  }

  cancel(command: string): void {
    const cached = this.findCachedByCommand(command);
    if (cached?.executionId && cached.status === 'running') {
      invoke('cancel_shell_command', { executionId: cached.executionId }).catch((err) =>
        logger.warn('Shell: failed to cancel', err),
      );
    }
  }
}
