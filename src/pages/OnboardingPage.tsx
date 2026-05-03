import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { OnboardingModal } from '../shared/components/ui/OnboardingModal';
import { settingsService } from '../features/settings';
import { useAppStore } from '../stores/appStore';
import type { Settings } from '../features/settings/types/settings.types';

export function OnboardingPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    invoke<Settings>('load_settings')
      .then((s) => {
        useAppStore.getState().setSettings(s);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

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
    // Notify main window so it updates its state
    await emit('volt://onboarding-complete', {});
    // Show + focus the main launcher window so the user actually sees Volt "launch"
    try {
      const main = await WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch { /* non-fatal */ }
    // Close onboarding window
    getCurrentWindow().close().catch(() => {});
  };

  if (!ready) return null;

  return <OnboardingModal isOpen={true} onComplete={handleComplete} />;
}
