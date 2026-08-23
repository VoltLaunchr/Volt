import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { OnboardingModal } from '../shared/components/ui/OnboardingModal';
import { settingsService } from '../features/settings';
import { useAppStore } from '../stores/appStore';
import type { Settings } from '../features/settings/types/settings.types';
import { useTauriEvent } from '../app/hooks/tauriEvent';

export function OnboardingPage() {
  const [ready, setReady] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    invoke<Settings>('load_settings')
      .then((s) => {
        useAppStore.getState().setSettings(s);
        setReady(true);
        // First-time launch: settings already say onboarding has not been seen,
        // so we don't need to wait for the main window's signal — show ourselves.
        if (s.general.hasSeenOnboarding === false) {
          setShouldShow(true);
        }
      })
      .catch(() => setReady(true));
  }, []);

  // Restart-onboarding flow: the main window resets `hasSeenOnboarding` and
  // emits this event so we re-show even after the OnboardingPage has been idle.
  useTauriEvent('volt://show-onboarding', () => setShouldShow(true));

  useEffect(() => {
    if (!ready || !shouldShow) return;
    const win = getCurrentWindow();
    let frame1 = 0;
    let frame2 = 0;
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        win
          .show()
          .then(() => win.setFocus())
          .catch(() => {});
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [ready, shouldShow]);

  const handleComplete = async () => {
    const settings = useAppStore.getState().settings;
    if (settings) {
      try {
        await settingsService.updateGeneralSettings({
          ...settings.general,
          hasSeenOnboarding: true,
        });
      } catch { /* non-fatal */ }
    }
    // Notify main window — it will show itself after its next paint cycle.
    // (See App.tsx: the `volt://onboarding-complete` listener flips
    // `hasSeenOnboarding`, which triggers the rAF-deferred show() effect.)
    await emit('volt://onboarding-complete', {});
    getCurrentWindow().close().catch(() => {});
  };

  if (!ready || !shouldShow) return null;

  return <OnboardingModal isOpen={true} onComplete={() => { void handleComplete(); }} />;
}
