/**
 * Feature flag utilities for the Feature Preview system.
 *
 * Features listed in PREVIEW_FEATURES are only available when the user
 * has enabled "Feature Preview" in Settings > General.
 * Features NOT listed are always available.
 */

export const PREVIEW_FEATURES: Record<string, boolean> = {
  // Future preview features will be added here
  // e.g. 'ai-search': true,
} as const;

/**
 * Check whether a feature is available given the current Feature Preview setting.
 *
 * - If the feature is listed in PREVIEW_FEATURES, it requires featurePreviewEnabled.
 * - If the feature is not listed, it is always available (stable).
 */
export function isFeatureAvailable(feature: string, featurePreviewEnabled: boolean): boolean {
  if (feature in PREVIEW_FEATURES) {
    return featurePreviewEnabled;
  }
  return true;
}
