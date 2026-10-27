import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import type { PopToRootDelay } from '../../features/settings/types/settings.types';
import { logger } from '../../shared/utils/logger';
import { PopToRootTracker } from '../popToRootTracker';

/** Time given to the OS to finish hiding the window before deciding it really is hidden. */
const HIDE_CONFIRM_MS = 150;

/**
 * "Pop to root": when the launcher comes back after having been hidden for longer than the
 * configured delay, `onPopToRoot` resets the query and the view; otherwise the previous state
 * is kept (the historical behaviour, delay `never`).
 *
 * The window is hidden and shown from Rust (global hotkey) as well as from the webview, so the
 * hook follows the window itself: a focus loss followed by `isVisible() === false` (a window
 * that merely lost focus stays visible and is not "closed"), plus the webview visibility signal.
 */
export function usePopToRoot(delay: PopToRootDelay | undefined, onPopToRoot: () => void): void {
  const [tracker] = useState(() => new PopToRootTracker());
  const delayRef = useRef(delay);
  const callbackRef = useRef(onPopToRoot);

  useEffect(() => {
    delayRef.current = delay;
    callbackRef.current = onPopToRoot;
  }, [delay, onPopToRoot]);

  useEffect(() => {
    let disposed = false;
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    const shown = () => {
      if (tracker.consumeShown(delayRef.current)) callbackRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') tracker.markHidden();
      else shown();
    };
    document.addEventListener('visibilitychange', onVisibility);

    try {
      const appWindow = getCurrentWindow();
      void appWindow
        .onFocusChanged(({ payload: focused }) => {
          clearTimeout(confirmTimer);
          if (focused) {
            shown();
            return;
          }
          const blurredAt = Date.now();
          confirmTimer = setTimeout(() => {
            void appWindow
              .isVisible()
              .then((visible) => {
                if (!disposed && !visible) tracker.markHidden(blurredAt);
              })
              .catch(() => {});
          }, HIDE_CONFIRM_MS);
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch((err: unknown) => logger.warn('Pop to root: focus tracking unavailable:', err));
    } catch (err) {
      logger.warn('Pop to root: window API unavailable:', err);
    }

    return () => {
      disposed = true;
      clearTimeout(confirmTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      unlisten?.();
    };
  }, [tracker]);
}
