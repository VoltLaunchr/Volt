import { describe, expectTypeOf, it } from 'vitest';
import type { SearchSensitivity as WireSearchSensitivity } from '../../../shared/types/generated/SearchSensitivity';
import type { IndexingSettings as WireIndexingSettings } from '../../../shared/types/generated/IndexingSettings';
import type { IndexingSettings, SearchSensitivity } from './settings.types';

/**
 * The settings value is forwarded verbatim to `search_streaming` as
 * `options.sensitivity`, which Rust deserialises into `search::SearchSensitivity`
 * (ts-rs generated). A drift between the two unions would silently fall back
 * to the serde error path, so pin them together.
 */
describe('settings.types IPC contracts', () => {
  it('SearchSensitivity matches the Rust ranker enum', () => {
    expectTypeOf<SearchSensitivity>().toEqualTypeOf<WireSearchSensitivity>();
  });
  it('IndexingSettings matches the Rust settings contract', () => {
    expectTypeOf<IndexingSettings>().toEqualTypeOf<WireIndexingSettings>();
  });
});
