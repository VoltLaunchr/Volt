export const WEB_BRAND_ICONS = {
  arc: '/icons/web/arc.webp',
  brave: '/icons/web/brave.webp',
  duckduckgo: '/icons/web/duckduckgo.webp',
  google: '/icons/web/google.webp',
  youtube: '/icons/web/youtube.webp',
} as const;

const FALLBACK_BRAND_BY_ID: Record<string, string> = {
  'fallback-duckduckgo': WEB_BRAND_ICONS.duckduckgo,
  'fallback-google': WEB_BRAND_ICONS.google,
  'fallback-youtube': WEB_BRAND_ICONS.youtube,
};

/**
 * Resolve built-in fallback branding by stable command id.
 *
 * Persisted settings from older Volt versions contain semantic Lucide names
 * such as `globe`, `shield`, and `youtube`. Resolving by id upgrades their
 * presentation without rewriting the user's settings or affecting custom
 * fallback commands.
 */
export function resolveFallbackBrandIcon(id: string, configuredIcon?: string): string | undefined {
  return FALLBACK_BRAND_BY_ID[id] ?? configuredIcon;
}
