import { useEffect, useRef } from 'react';
import {
  listen,
  type Event,
  type UnlistenFn,
} from '@tauri-apps/api/event';
import { logger } from '../../shared/utils/logger';

export function useTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<T>(eventName, (event: Event<T>) => {
      handlerRef.current(event.payload);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }

        unlisten = fn;
      })
      .catch((error) => {
        logger.error(`Failed to listen to ${eventName}`, error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [eventName]);
}
