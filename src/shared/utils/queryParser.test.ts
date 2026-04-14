import { describe, it, expect } from 'vitest';
import { parseQuery } from './queryParser';

describe('parseQuery', () => {
  it('returns raw query when no operators', () => {
    const result = parseQuery('firefox');
    expect(result.searchQuery).toBe('firefox');
    expect(result.hasOperators).toBe(false);
    expect(result.operators).toEqual({});
  });

  it('parses ext: operator', () => {
    const result = parseQuery('budget ext:pdf');
    expect(result.searchQuery).toBe('budget');
    expect(result.hasOperators).toBe(true);
    expect(result.operators.ext).toBe('pdf');
  });

  it('strips leading dot from ext', () => {
    const result = parseQuery('ext:.txt readme');
    expect(result.operators.ext).toBe('txt');
  });

  it('parses in: operator', () => {
    const result = parseQuery('notes in:~/Documents');
    expect(result.searchQuery).toBe('notes');
    expect(result.operators.dir).toBe('~/Documents');
  });

  it('parses size:>10mb', () => {
    const result = parseQuery('video size:>10mb');
    expect(result.searchQuery).toBe('video');
    expect(result.operators.sizeMin).toBe(10 * 1024 * 1024);
  });

  it('parses size:<1gb', () => {
    const result = parseQuery('size:<1gb backup');
    expect(result.searchQuery).toBe('backup');
    expect(result.operators.sizeMax).toBe(1024 ** 3);
  });

  it('parses modified:<7d', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = parseQuery('modified:<7d report');
    expect(result.searchQuery).toBe('report');
    expect(result.operators.modifiedAfter).toBeGreaterThan(now - 7 * 86400 - 2);
    expect(result.operators.modifiedAfter).toBeLessThanOrEqual(now - 7 * 86400 + 2);
  });

  it('parses modified:>30d', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = parseQuery('modified:>30d old');
    expect(result.searchQuery).toBe('old');
    expect(result.operators.modifiedBefore).toBeGreaterThan(now - 30 * 86400 - 2);
  });

  it('handles multiple operators', () => {
    const result = parseQuery('ext:pdf size:>1mb in:~/Work notes');
    expect(result.searchQuery).toBe('notes');
    expect(result.operators.ext).toBe('pdf');
    expect(result.operators.sizeMin).toBe(1024 * 1024);
    expect(result.operators.dir).toBe('~/Work');
  });

  it('handles query with no text after stripping operators', () => {
    const result = parseQuery('ext:pdf');
    expect(result.searchQuery).toBe('');
    expect(result.hasOperators).toBe(true);
    expect(result.operators.ext).toBe('pdf');
  });

  it('does not match operators in middle of words', () => {
    // "text:hello" should not match as ext:hello
    const result = parseQuery('context:hello');
    expect(result.hasOperators).toBe(false);
  });

  it('handles size with no unit (bytes)', () => {
    const result = parseQuery('size:>1024');
    expect(result.operators.sizeMin).toBe(1024);
  });

  it('handles size with kb', () => {
    const result = parseQuery('size:<500kb');
    expect(result.operators.sizeMax).toBe(500 * 1024);
  });

  it('handles modified with hours and weeks', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = parseQuery('modified:<2w');
    expect(result.operators.modifiedAfter).toBeGreaterThan(now - 14 * 86400 - 2);
  });
});
