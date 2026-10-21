import { describe, it, expectTypeOf } from 'vitest';
import type {
  AppInfo,
  FileCategory,
  FileInfo,
  FileSearchResult,
  PluginResultData,
} from './common.types';

/**
 * Type-level regression guard for the Rust↔TS contracts in `common.types.ts`.
 *
 * `AppInfo`, `FileInfo` and `FileCategory` are now generated from the Rust IPC
 * structs by ts-rs (single source of truth — see `generated/`). These guards
 * pin the *generated* contract so an accidental shape change is caught:
 *
 * - `FileSearchResult` MUST be assignable to `FileInfo` (it `extends FileInfo`).
 * - `FileInfo.created`/`accessed` mirror Rust `Option<i64>` → `number | undefined`.
 * - `FileInfo.category` mirrors Rust `FileCategory` with `#[serde(default)]`:
 *   it is ALWAYS serialised, so the wire (and the generated type) makes it a
 *   REQUIRED `FileCategory`, not optional.
 * - `AppInfo.category` mirrors Rust `Option<String>` → `string | undefined`.
 *   The semantic `AppCategory` enum still drives call sites, but the generated
 *   wire type is a plain string (see apps.rs DECISION comment).
 * - `PluginResultData` MUST expose `pluginId`/`badge` (consumers cast the
 *   field then read these props at runtime).
 */
describe('common.types contracts', () => {
  it('FileSearchResult is structurally a FileInfo plus score/matchedIndices', () => {
    expectTypeOf<FileSearchResult>().toMatchTypeOf<FileInfo>();
    expectTypeOf<FileSearchResult>().toHaveProperty('score').toEqualTypeOf<number>();
    expectTypeOf<FileSearchResult>().toHaveProperty('matchedIndices').toEqualTypeOf<number[]>();
  });

  it('FileInfo carries created/accessed (Rust Option<i64>) and a required category', () => {
    expectTypeOf<FileInfo>().toHaveProperty('created').toEqualTypeOf<number | undefined>();
    expectTypeOf<FileInfo>().toHaveProperty('accessed').toEqualTypeOf<number | undefined>();
    expectTypeOf<FileInfo>().toHaveProperty('category').toEqualTypeOf<FileCategory>();
  });

  it('PluginResultData exposes pluginId and badge as optionals', () => {
    expectTypeOf<PluginResultData>().toHaveProperty('pluginId').toEqualTypeOf<string | undefined>();
    expectTypeOf<PluginResultData>().toHaveProperty('badge').toEqualTypeOf<string | undefined>();
  });

  it('AppInfo.category is the wire string type (Rust Option<String>)', () => {
    expectTypeOf<AppInfo>().toHaveProperty('category').toEqualTypeOf<string | undefined>();
  });
});
