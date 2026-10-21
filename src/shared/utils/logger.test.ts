import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { logger } from './logger';

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards error calls to console.error', () => {
    logger.error('boom', { id: 1 });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('boom', { id: 1 });
  });

  it('forwards warn calls to console.warn', () => {
    logger.warn('careful');
    expect(console.warn).toHaveBeenCalledWith('careful');
  });

  it('exposes info and debug which do not throw', () => {
    expect(() => logger.info('hello', 1, 2)).not.toThrow();
    expect(() => logger.debug('hi')).not.toThrow();
  });

  it('does not throw when the backend invoke rejects', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockRejectedValueOnce(new Error('no such command: log_from_frontend'));
    expect(() => logger.error('still fine', 'arg')).not.toThrow();
    // Let the swallowed promise settle before the test exits.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(console.error).toHaveBeenCalledWith('still fine', 'arg');
  });

  it('serializes args and invokes the backend bridge on error', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockClear();
    logger.error('oops', { a: 1 }, 'extra');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockInvoke).toHaveBeenCalledWith(
      'log_from_frontend',
      expect.objectContaining({
        level: 'error',
        message: 'oops',
        args: JSON.stringify([{ a: 1 }, 'extra']),
      }),
    );
  });
});
