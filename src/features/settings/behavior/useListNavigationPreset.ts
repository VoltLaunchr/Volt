import { useAppStore } from '../../../stores/appStore';
import type { ListNavigationPreset } from '../types/settings.types';

/** Extra list navigation keys chosen in Settings -> Keyboard (default: emacs, as before). */
export function useListNavigationPreset(): ListNavigationPreset {
  return useAppStore((state) => state.settings?.keyboard?.listNavigation) ?? 'emacs';
}
