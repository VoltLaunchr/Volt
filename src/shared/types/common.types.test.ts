import { describe, it, expectTypeOf } from 'vitest';
import type {
  AppInfo,
  AppCategory,
  FileCategory,
  FileInfo,
  FileSearchResult,
  PluginResultData,
} from './common.types';

/**
 * Type-level regression guard for the Rust↔TS contracts in `common.types.ts`.
 *
 * - `FileSearchResult` MUST be assignable to `FileInfo` (it `extends FileInfo`).
 * - `FileInfo` MUST expose `created`/`accessed`/`category` (Rust serializes
 *   them; without them the front loses access to the data).
 * - `PluginResultData` MUST expose `pluginId`/`badge` (consumers cast the
 *   field then read these props at runtime — typed-undefined was masking the
 *   actual contract).
 */
describe('common.types contracts', () => {
  it('FileSearchResult is structurally a FileInfo plus score/matchedIndices', () => {
    expectTypeOf<FileSearchResult>().toMatchTypeOf<FileInfo>();
    expectTypeOf<FileSearchResult>().toHaveProperty('score').toEqualTypeOf<number>();
    expectTypeOf<FileSearchResult>().toHaveProperty('matchedIndices').toEqualTypeOf<number[]>();
  });

  it('FileInfo carries created/accessed/category (mirrors Rust Option<i64> / FileCategory)', () => {
    expectTypeOf<FileInfo>().toHaveProperty('created').toEqualTypeOf<number | undefined>();
    expectTypeOf<FileInfo>().toHaveProperty('accessed').toEqualTypeOf<number | undefined>();
    expectTypeOf<FileInfo>()
      .toHaveProperty('category')
      .toEqualTypeOf<FileCategory | undefined>();
  });

  it('PluginResultData exposes pluginId and badge as optionals', () => {
    expectTypeOf<PluginResultData>().toHaveProperty('pluginId').toEqualTypeOf<string | undefined>();
    expectTypeOf<PluginResultData>().toHaveProperty('badge').toEqualTypeOf<string | undefined>();
  });

  it('AppInfo references AppCategory, not raw string', () => {
    expectTypeOf<AppInfo>()
      .toHaveProperty('category')
      .toEqualTypeOf<AppCategory | undefined>();
  });
});
