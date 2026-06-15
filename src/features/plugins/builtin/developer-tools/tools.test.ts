import { describe, it, expect } from 'vitest';
import { md5 } from './md5';
import {
  convertColor,
  decodeBase64,
  encodeBase64,
  generateLorem,
  generateUuid,
  hashText,
} from './tools';

describe('md5', () => {
  it('matches known vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
  });

  it('handles unicode (UTF-8 bytes)', () => {
    // md5 of "héllo" computed over its UTF-8 byte sequence (matches Node crypto)
    expect(md5('héllo')).toBe('be50e8478cf24ff3595bc7307fb91b50');
  });
});

describe('hashText', () => {
  it('computes sha1/sha256/sha512 of "hello"', async () => {
    expect(await hashText('sha1', 'hello')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    expect(await hashText('sha256', 'hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect((await hashText('sha512', 'hello')).slice(0, 16)).toBe('9b71d224bd62f378');
  });

  it('routes md5 through the pure-JS implementation', async () => {
    expect(await hashText('md5', 'hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });
});

describe('base64', () => {
  it('round-trips ascii', () => {
    expect(encodeBase64('hello')).toBe('aGVsbG8=');
    expect(decodeBase64('aGVsbG8=')).toBe('hello');
  });

  it('round-trips unicode', () => {
    const text = 'héllo 🌍';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('throws on invalid base64', () => {
    expect(() => decodeBase64('@@@not-base64@@@')).toThrow();
  });
});

describe('convertColor', () => {
  it('converts 6-digit hex', () => {
    const result = convertColor('#ff5722');
    expect(result).not.toBeNull();
    expect(result?.hex).toBe('#FF5722');
    expect(result?.rgb).toBe('rgb(255, 87, 34)');
    expect(result?.hsl).toBe('hsl(14, 100%, 57%)');
  });

  it('expands 3-digit hex and accepts rgb()', () => {
    expect(convertColor('#fff')?.rgb).toBe('rgb(255, 255, 255)');
    expect(convertColor('rgb(0, 0, 0)')?.hex).toBe('#000000');
  });

  it('returns null for non-colors', () => {
    expect(convertColor('not a color')).toBeNull();
    expect(convertColor('rgb(300, 0, 0)')).toBeNull();
  });
});

describe('generateLorem', () => {
  it('produces the requested word count', () => {
    const words = generateLorem(50).replace(/\.$/, '').split(' ');
    expect(words).toHaveLength(50);
  });

  it('starts with the canonical opening', () => {
    expect(generateLorem(5).startsWith('Lorem ipsum dolor sit amet')).toBe(true);
  });
});

describe('generateUuid', () => {
  it('returns a v4 UUID', () => {
    expect(generateUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
