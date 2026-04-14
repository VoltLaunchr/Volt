/* global localStorage */
/**
 * Lightweight logging wrapper.
 *
 * - In dev, forwards all levels to `console.*`.
 * - In prod, only `warn`/`error` reach the console unless the user opts in
 *   via `localStorage.setItem('volt:verbose', '1')`.
 * - `error` additionally tries to ship the event to the Rust side through the
 *   `log_from_frontend` Tauri command. Failures are swallowed so the logger
 *   stays safe in jsdom/test environments where the command may not exist.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDev = (): boolean => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
};

const isVerbose = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('volt:verbose') === '1';
  } catch {
    return false;
  }
};

const shouldEmit = (level: LogLevel): boolean => {
  if (level === 'warn' || level === 'error') return true;
  return isDev() || isVerbose();
};

const forwardToBackend = (level: LogLevel, message: string, args: unknown[]): void => {
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      let serializedArgs = '[]';
      try {
        serializedArgs = JSON.stringify(args);
      } catch {
        serializedArgs = '[]';
      }
      await invoke('log_from_frontend', {
        level,
        message,
        args: serializedArgs,
      });
    } catch {
      // Intentionally swallow — backend command may not exist (e.g. tests).
    }
  })();
};

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldEmit('debug')) console.debug(message, ...args);
  },
  info(message: string, ...args: unknown[]): void {
    if (shouldEmit('info')) console.info(message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    if (shouldEmit('warn')) console.warn(message, ...args);
  },
  error(message: string, ...args: unknown[]): void {
    if (shouldEmit('error')) console.error(message, ...args);
    forwardToBackend('error', message, args);
  },
};

export type Logger = typeof logger;
