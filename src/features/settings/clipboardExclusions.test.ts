import { describe, expect, it } from 'vitest';
import { addClipboardAppExclusion, normalizeClipboardAppName } from './clipboardExclusions';

describe('clipboard application exclusions', () => {
  it('matches foreground executable stems when a Windows filename is pasted', () => {
    expect(normalizeClipboardAppName('  1Password.EXE  ')).toBe('1password');
    expect(normalizeClipboardAppName('1password')).toBe('1password');
    expect(normalizeClipboardAppName(' .exe ')).toBe('');
    expect(normalizeClipboardAppName('   ')).toBe('');
  });

  it('preserves non-Windows application names and internal dots', () => {
    expect(normalizeClipboardAppName('  org.keepassxc.KeePassXC  ')).toBe(
      'org.keepassxc.keepassxc'
    );
    expect(normalizeClipboardAppName('gnome-terminal-server')).toBe('gnome-terminal-server');
    expect(normalizeClipboardAppName('foo.exe.helper')).toBe('foo.exe.helper');
    expect(addClipboardAppExclusion([], 'foo.exe.exe')).toEqual(['foo.exe']);
  });

  it('deduplicates canonical new names without modifying existing values or removal identity', () => {
    const existing = ['1password', 'KeePassXC'];
    expect(addClipboardAppExclusion(existing, '  1PASSWORD.exe ')).toEqual(existing);
    expect(addClipboardAppExclusion(existing, 'keepassxc')).toEqual(existing);
    expect(addClipboardAppExclusion(existing, ' Firefox.EXE ')).toEqual([...existing, 'firefox']);
    expect(addClipboardAppExclusion(existing, ' .exe ')).toEqual(existing);
    expect(existing).toEqual(['1password', 'KeePassXC']);
  });
});
