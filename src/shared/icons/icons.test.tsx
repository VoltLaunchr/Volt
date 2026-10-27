import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_GLYPHS,
} from '@/features/settings/constants/settingsCategories';
import { VOLT_GLYPHS, VOLT_ICON_NAMES, hasVoltGlyph } from './glyphs';
import { VoltIcon } from './VoltIcon';
import { VoltIconTile } from './VoltIconTile';

describe('Volt glyph set', () => {
  it('gives every Settings category a registered glyph', () => {
    for (const { id } of SETTINGS_CATEGORIES) {
      const name = SETTINGS_CATEGORY_GLYPHS[id];
      expect(name, id).toBeDefined();
      expect(hasVoltGlyph(name), id).toBe(true);
    }
  });

  it('uses unique glyph names, one per category, with drawn paths', () => {
    expect(new Set(VOLT_ICON_NAMES).size).toBe(VOLT_ICON_NAMES.length);
    const used = Object.values(SETTINGS_CATEGORY_GLYPHS);
    expect(new Set(used).size).toBe(used.length);
    for (const name of VOLT_ICON_NAMES) expect(VOLT_GLYPHS[name].paths.length).toBeGreaterThan(0);
  });

  it('renders a decorative 16x16 currentColor svg by default', () => {
    const html = renderToStaticMarkup(<VoltIcon name="sliders" />);
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<title>');
  });

  it('exposes a title as an accessible name and supports the filled variant', () => {
    const html = renderToStaticMarkup(<VoltIcon name="user" title="Account" variant="filled" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('<title>Account</title>');
    expect(html).not.toContain('aria-hidden');
    expect(html).toContain('fill="currentColor"');
  });

  it('renders a 22px tile and flags the active state', () => {
    const html = renderToStaticMarkup(<VoltIconTile name="globe" active />);
    expect(html).toContain('width:22px');
    expect(html).toContain('data-active="true"');
  });
});
