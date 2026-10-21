/**
 * Pure computation primitives for the Developer Tools plugin.
 *
 * Kept separate from the plugin class so they can be unit-tested without a
 * React/Tauri runtime. All functions are synchronous except hashing, which
 * relies on the async Web Crypto API for SHA variants.
 */

import { md5 } from './md5';

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

export const HASH_ALGORITHMS: HashAlgorithm[] = ['md5', 'sha1', 'sha256', 'sha512'];

/** Generate a RFC 4122 v4 UUID. */
export function generateUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** UTF-8 safe base64 encode. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/**
 * UTF-8 safe base64 decode. Throws if the input is not valid base64.
 */
export function decodeBase64(text: string): string {
  const binary = globalThis.atob(text.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const SUBTLE_ALGO: Record<Exclude<HashAlgorithm, 'md5'>, string> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha512: 'SHA-512',
};

/** Compute a lowercase hex digest of `text` using the given algorithm. */
export async function hashText(algo: HashAlgorithm, text: string): Promise<string> {
  if (algo === 'md5') return md5(text);
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest(SUBTLE_ALGO[algo], data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ColorResult {
  hex: string;
  rgb: string;
  hsl: string;
}

/**
 * Parse a hex (`#rgb` / `#rrggbb`) or `rgb(r, g, b)` color and return all three
 * representations. Returns null if the input is not a recognized color.
 */
export function convertColor(input: string): ColorResult | null {
  const trimmed = input.trim().toLowerCase();
  let r: number;
  let g: number;
  let b: number;

  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(trimmed);

  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (rgbMatch) {
    r = Number(rgbMatch[1]);
    g = Number(rgbMatch[2]);
    b = Number(rgbMatch[3]);
    if (r > 255 || g > 255 || b > 255) return null;
  } else {
    return null;
  }

  const hex =
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

  return { hex, rgb: `rgb(${r}, ${g}, ${b})`, hsl: rgbToHsl(r, g, b) };
}

function rgbToHsl(r: number, g: number, b: number): string {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip',
  'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat',
];

/**
 * Generate `count` lorem ipsum words. The output always starts with the
 * canonical "Lorem ipsum dolor sit amet" opening when count is large enough.
 */
export function generateLorem(count: number): string {
  const n = Math.max(1, Math.min(count, 500));
  const words: string[] = [];
  for (let i = 0; i < n; i++) {
    words.push(LOREM_WORDS[i % LOREM_WORDS.length]);
  }
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
