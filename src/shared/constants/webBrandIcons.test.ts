import { describe, expect, it } from 'vitest';
import { resolveFallbackBrandIcon, WEB_BRAND_ICONS } from './webBrandIcons';

describe('resolveFallbackBrandIcon', () => {
  it('upgrades persisted built-in fallback icons to bundled brand assets', () => {
    expect(resolveFallbackBrandIcon('fallback-google', 'globe')).toBe(WEB_BRAND_ICONS.google);
    expect(resolveFallbackBrandIcon('fallback-duckduckgo', 'shield')).toBe(
      WEB_BRAND_ICONS.duckduckgo
    );
    expect(resolveFallbackBrandIcon('fallback-youtube', 'youtube')).toBe(WEB_BRAND_ICONS.youtube);
  });

  it('preserves icons configured on custom fallbacks', () => {
    expect(resolveFallbackBrandIcon('my-custom-search', 'sparkles')).toBe('sparkles');
  });
});
