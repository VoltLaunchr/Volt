import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { logger } from '../../../shared/utils/logger';
import { settingsService } from '../services/settingsService';
import { normalizeBehaviorSettings } from './normalize';
import type { Settings } from '../types/settings.types';

/**
 * Settings for windows that do not own the app store (System Monitor, Notes): loaded once,
 * then kept current through the `settings-changed` event every save broadcasts.
 * `null` until the first load completes.
 */
export function useLiveSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void settingsService.loadSettings().then((loaded) => {
      if (!disposed) setSettings((current) => current ?? loaded);
    });
    void listen<Settings>('settings-changed', (event) => {
      if (!disposed) setSettings(normalizeBehaviorSettings(event.payload));
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((err: unknown) => logger.warn('Live settings unavailable:', err));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return settings;
}
