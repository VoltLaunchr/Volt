import type { AppearanceSettings } from '../types/settings.types';

export const TRANSPARENCY_MIN = 0.5;
export const TRANSPARENCY_MAX = 1;
export const TRANSPARENCY_DEFAULT = 0.85;
export const TRANSPARENCY_STEP = 0.05;

export function clampTransparency(value: number): number {
  return Math.min(TRANSPARENCY_MAX, Math.max(TRANSPARENCY_MIN, value));
}

/** User-facing opacity for the launcher shell (0.5–1). Solid mode forces 1. */
export function resolveShellOpacity(
  transparency: number,
  windowEffect: AppearanceSettings['windowEffect']
): number {
  if (windowEffect === 'solid') {
    return 1;
  }
  return clampTransparency(transparency);
}

/**
 * Apply the shell opacity slider to CSS custom properties consumed by global.css
 * and theme.css (glass shell + surface ladder in native material modes).
 */
export function applyWindowOpacity(
  transparency: number,
  windowEffect: AppearanceSettings['windowEffect'] = 'volt-glass'
): void {
  const opacity = resolveShellOpacity(transparency, windowEffect);
  document.documentElement.style.setProperty('--window-opacity', String(opacity));
}

export function applyAppearance(appearance: Pick<AppearanceSettings, 'windowEffect' | 'transparency'>): void {
  applyWindowOpacity(appearance.transparency, appearance.windowEffect);
}
