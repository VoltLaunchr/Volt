import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppCategory } from '../../../shared/types/common.types';

/**
 * Regression guard for the Rust↔TS AppCategory string contract.
 *
 * Until v0.1.7, Rust produced capitalized strings ("Games", "Development", ...)
 * while TS expected lowercase ('gaming', 'development', ...). The mismatch
 * meant every app fell through to AppCategory.Other in the UI. This test pins
 * both sides: every literal returned by `detect_app_category` must be a known
 * TS enum value, and every TS enum value must be reachable from Rust.
 */
describe('AppCategory Rust↔TS contract', () => {
  const appsRsPath = join(__dirname, '../../../../src-tauri/src/commands/launcher/apps.rs');
  // Normalize CRLF→LF: on Windows CI the file is checked out with CRLF and
  // the `\n\}\n` regex anchor below would never match the closing brace.
  const source = readFileSync(appsRsPath, 'utf8').replace(/\r\n/g, '\n');

  // Extract every `return "X".to_string();` and the trailing default
  // `"X".to_string()` from the function. The detector lives between
  // `fn detect_app_category` and the next top-level item.
  const detector = source.match(/fn detect_app_category[\s\S]*?\n\}\n/)?.[0] ?? '';
  expect(detector, 'detect_app_category function should be findable').not.toBe('');

  const literals = new Set<string>();
  for (const m of detector.matchAll(/"([a-zA-Z]+)"\.to_string\(\)/g)) {
    literals.add(m[1]);
  }
  // The implicit-tail default ("other".to_string() with no `return`) is also
  // captured by the regex above.

  const enumValues = new Set<string>(Object.values(AppCategory));

  it('every Rust category literal exists in the TS enum', () => {
    for (const lit of literals) {
      expect(
        enumValues.has(lit),
        `Rust returns category "${lit}" which is not in AppCategory enum`
      ).toBe(true);
    }
  });

  it('every TS enum value is producible by Rust', () => {
    for (const v of enumValues) {
      expect(literals.has(v), `AppCategory.${v} has no producer in Rust detect_app_category`).toBe(
        true
      );
    }
  });
});
