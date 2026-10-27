/**
 * Operating systems a setting can be restricted to. Used by the registry `availability` field to
 * show a platform badge and to keep settings that cannot work on this OS out of the search.
 */
export type SettingsPlatform = 'windows' | 'macos' | 'linux';

export interface SettingsAvailability {
  /** The setting only has an effect on these platforms. */
  readonly platforms: readonly SettingsPlatform[];
}

export const SETTINGS_PLATFORM_LABELS: Record<SettingsPlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

/** Detects the host OS from the webview user agent; `null` when it cannot be told. */
export function detectSettingsPlatform(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent
): SettingsPlatform | null {
  if (/windows/i.test(userAgent)) return 'windows';
  if (/mac os|macintosh|darwin/i.test(userAgent)) return 'macos';
  if (/linux|x11|cros/i.test(userAgent)) return 'linux';
  return null;
}

/** An unknown platform is treated as supported: a badge is never worth hiding a working setting. */
export function isAvailableOn(
  availability: SettingsAvailability | undefined,
  platform: SettingsPlatform | null
): boolean {
  if (!availability || platform === null) return true;
  return availability.platforms.includes(platform);
}
