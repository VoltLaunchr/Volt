/**
 * Developer Tools Plugin — quick text/encoding utilities.
 *
 * Triggers (first token of the query):
 *   uuid | guid              → generate a v4 UUID
 *   base64 <text>            → encode to base64 (base64 -d <text> / base64d <text> to decode)
 *   md5|sha1|sha256|sha512 <text> → hash
 *   hash [algo] <text>       → hash (defaults to sha256)
 *   color <value> | #rrggbb  → convert between HEX / RGB / HSL
 *   lorem [n]                → n words of lorem ipsum (default 30)
 *
 * Selecting a result copies its value to the clipboard.
 */

import type { Plugin, PluginActivation, PluginContext, PluginResult } from '../../types';
import { PluginResultType } from '../../types';
import { logger } from '../../../../shared/utils/logger';
import {
  convertColor,
  decodeBase64,
  encodeBase64,
  generateLorem,
  generateUuid,
  hashText,
  HASH_ALGORITHMS,
  type HashAlgorithm,
} from './tools';

const BADGE = 'Dev Tools';
const DEFAULT_LOREM_WORDS = 30;

type ParsedQuery =
  | { kind: 'uuid' }
  | { kind: 'base64'; mode: 'encode' | 'decode'; text: string }
  | { kind: 'hash'; algo: HashAlgorithm; text: string }
  | { kind: 'color'; value: string }
  | { kind: 'lorem'; count: number }
  | null;

function parse(rawQuery: string): ParsedQuery {
  const raw = rawQuery.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const [head, ...restParts] = raw.split(/\s+/);
  const headLower = head.toLowerCase();
  const rest = restParts.join(' ');

  if (headLower === 'uuid' || headLower === 'guid') {
    return { kind: 'uuid' };
  }

  if (headLower === 'base64' || headLower === 'b64') {
    const decodeFlag = /^(-d|--decode|decode|d)\b/i.exec(rest);
    if (decodeFlag) {
      return { kind: 'base64', mode: 'decode', text: rest.slice(decodeFlag[0].length).trim() };
    }
    return { kind: 'base64', mode: 'encode', text: rest };
  }
  if (headLower === 'base64d' || headLower === 'b64d') {
    return { kind: 'base64', mode: 'decode', text: rest };
  }

  if ((HASH_ALGORITHMS as string[]).includes(headLower)) {
    return { kind: 'hash', algo: headLower as HashAlgorithm, text: rest };
  }
  if (headLower === 'hash') {
    const maybeAlgo = restParts[0]?.toLowerCase();
    if (maybeAlgo && (HASH_ALGORITHMS as string[]).includes(maybeAlgo)) {
      return { kind: 'hash', algo: maybeAlgo as HashAlgorithm, text: restParts.slice(1).join(' ') };
    }
    return { kind: 'hash', algo: 'sha256', text: rest };
  }

  if (headLower === 'color' && rest) {
    return { kind: 'color', value: rest };
  }
  // Bare hex color, e.g. "#ff5722"
  if (/^#?[0-9a-f]{6}$/i.test(lower) || /^#[0-9a-f]{3}$/i.test(lower)) {
    return { kind: 'color', value: raw };
  }

  if (headLower === 'lorem' || headLower === 'lipsum') {
    const count = Number.parseInt(restParts[0] ?? '', 10);
    return { kind: 'lorem', count: Number.isFinite(count) && count > 0 ? count : DEFAULT_LOREM_WORDS };
  }

  return null;
}

function copyResult(
  id: string,
  title: string,
  subtitle: string,
  copyValue: string,
  score = 100,
): PluginResult {
  return {
    id,
    type: PluginResultType.Info,
    title,
    subtitle,
    badge: BADGE,
    score,
    data: { copyValue },
  };
}

export class DeveloperToolsPlugin implements Plugin {
  id = 'developer-tools';
  name = 'Developer Tools';
  description = 'UUID, base64, hashing, color conversion, and lorem ipsum';
  enabled = true;

  // `mode: 'custom'` — canHandle delegates to the dedicated query parser; these
  // keywords drive only the scoring boost (query starting with a tool name).
  activation: PluginActivation = {
    mode: 'custom',
    keywords: [
      'uuid', 'guid', 'base64', 'b64', 'md5', 'sha1', 'sha256', 'sha512',
      'hash', 'color', 'lorem', 'lipsum',
    ],
  };

  canHandle(context: PluginContext): boolean {
    return parse(context.query) !== null;
  }

  async match(context: PluginContext): Promise<PluginResult[]> {
    const parsed = parse(context.query);
    if (!parsed) return [];

    switch (parsed.kind) {
      case 'uuid': {
        const value = generateUuid();
        return [copyResult('devtools-uuid', `🆔 ${value}`, 'UUID v4 — press Enter to copy', value)];
      }

      case 'base64': {
        if (!parsed.text) {
          return [
            copyResult(
              'devtools-base64-hint',
              parsed.mode === 'decode' ? '🔓 Base64 decode' : '🔒 Base64 encode',
              parsed.mode === 'decode'
                ? 'Type text to decode: base64 -d <text>'
                : 'Type text to encode: base64 <text>',
              '',
              90,
            ),
          ];
        }
        try {
          if (parsed.mode === 'encode') {
            const value = encodeBase64(parsed.text);
            return [copyResult('devtools-base64', `🔒 ${value}`, 'Base64 encoded — press Enter to copy', value)];
          }
          const value = decodeBase64(parsed.text);
          return [copyResult('devtools-base64', `🔓 ${value}`, 'Base64 decoded — press Enter to copy', value)];
        } catch {
          return [
            copyResult('devtools-base64-error', '⚠️ Invalid base64', 'The input is not valid base64', '', 90),
          ];
        }
      }

      case 'hash': {
        if (!parsed.text) {
          return [
            copyResult(
              'devtools-hash-hint',
              `#️⃣ ${parsed.algo.toUpperCase()} hash`,
              `Type text to hash: ${parsed.algo} <text>`,
              '',
              90,
            ),
          ];
        }
        try {
          const value = await hashText(parsed.algo, parsed.text);
          return [
            copyResult(
              'devtools-hash',
              `#️⃣ ${value}`,
              `${parsed.algo.toUpperCase()} — press Enter to copy`,
              value,
            ),
          ];
        } catch (err) {
          logger.error('Developer Tools: hash failed', err);
          return [copyResult('devtools-hash-error', '⚠️ Hash failed', String(err), '', 90)];
        }
      }

      case 'color': {
        const color = convertColor(parsed.value);
        if (!color) {
          return [
            copyResult(
              'devtools-color-hint',
              '🎨 Color converter',
              'Type a color: color #ff5722 or color rgb(255,87,34)',
              '',
              90,
            ),
          ];
        }
        return [
          copyResult('devtools-color-hex', `🎨 ${color.hex}`, 'HEX — press Enter to copy', color.hex, 100),
          copyResult('devtools-color-rgb', `🎨 ${color.rgb}`, 'RGB — press Enter to copy', color.rgb, 99),
          copyResult('devtools-color-hsl', `🎨 ${color.hsl}`, 'HSL — press Enter to copy', color.hsl, 98),
        ];
      }

      case 'lorem': {
        const value = generateLorem(parsed.count);
        return [
          copyResult(
            'devtools-lorem',
            `📝 ${value.length > 70 ? value.slice(0, 70) + '…' : value}`,
            `Lorem ipsum (${parsed.count} words) — press Enter to copy`,
            value,
          ),
        ];
      }

      default:
        return [];
    }
  }

  async execute(result: PluginResult): Promise<void> {
    const value = (result.data as { copyValue?: string })?.copyValue;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      window.dispatchEvent(
        new CustomEvent('volt:toast', {
          detail: { message: 'Copied to clipboard', style: 'success', duration: 2000 },
        }),
      );
    } catch (err) {
      logger.error('Developer Tools: clipboard write failed', err);
    }
  }
}
