import { emit } from '@tauri-apps/api/event';
import { Effect, getCurrentWindow, Window } from '@tauri-apps/api/window';
import { logger } from '../../../shared/utils/logger';
import type { AppearanceSettings, WindowEffect } from '../../settings/types/settings.types';
import { applyWindowOpacity } from '../../settings/services/appearanceService';

const MAIN_WINDOW_LABEL = 'main';

async function resolveWindow(label: string): Promise<Window | null> {
  const current = getCurrentWindow();
  if (current.label === label) {
    return current;
  }
  return (await Window.getByLabel(label)) ?? null;
}

async function applyNativeEffect(win: Window, effect: WindowEffect): Promise<void> {
  if (effect === 'volt-glass' || effect === 'solid') {
    try {
      await win.clearEffects();
    } catch {
      await win.setEffects({ effects: [] });
    }
    return;
  }

  const nativeEffect = effect === 'mica' ? Effect.Mica : Effect.Acrylic;
  await win.setEffects({ effects: [nativeEffect] });
}

/**
 * Apply the window material to the current webview (CSS) and a Tauri window (native DWM).
 */
export async function applyWindowEffect(
  effect: WindowEffect,
  targetLabel = MAIN_WINDOW_LABEL,
  transparency = 0.85
): Promise<void> {
  document.documentElement.setAttribute('data-window-effect', effect);
  applyWindowOpacity(transparency, effect);

  try {
    const win = await resolveWindow(targetLabel);
    if (!win) {
      return;
    }
    await applyNativeEffect(win, effect);
  } catch (error) {
    logger.warn('Native window effect unavailable, using volt-glass fallback:', error);
    document.documentElement.setAttribute('data-window-effect', 'volt-glass');
    applyWindowOpacity(transparency, 'volt-glass');
    try {
      const win = await resolveWindow(targetLabel);
      await win?.clearEffects();
    } catch {
      // Best-effort cleanup when the platform does not support effects.
    }
  }
}

/**
 * Live-preview appearance on the main launcher from the settings window.
 */
export async function previewAppearanceOnMain(
  appearance: Pick<AppearanceSettings, 'windowEffect' | 'transparency'>
): Promise<void> {
  try {
    const main = await Window.getByLabel(MAIN_WINDOW_LABEL);
    if (main) {
      await applyNativeEffect(main, appearance.windowEffect);
    }
    await emit('volt://appearance-preview', appearance);
  } catch (error) {
    logger.warn('Failed to preview appearance on main window:', error);
  }
}
