import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppShortcut } from '../types/settings.types';

const BATCH_SIZE = 4;

function normalizeIconSrc(icon: string): string {
  if (icon.startsWith('data:') || icon.startsWith('/') || /^https?:\/\//i.test(icon)) {
    return icon;
  }
  return `data:image/png;base64,${icon}`;
}

export function stripShortcutIcon(shortcut: AppShortcut): AppShortcut {
  const { icon: _icon, ...rest } = shortcut;
  return rest;
}

export function useShortcutAppIcons(shortcuts: AppShortcut[], enabled: boolean) {
  const [iconsByPath, setIconsByPath] = useState<Record<string, string>>({});
  const [failedPaths, setFailedPaths] = useState<Set<string>>(() => new Set());
  const iconsByPathRef = useRef<Record<string, string>>({});
  const failedPathsRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    iconsByPathRef.current = iconsByPath;
  }, [iconsByPath]);

  useEffect(() => {
    failedPathsRef.current = failedPaths;
  }, [failedPaths]);

  useEffect(() => {
    abortRef.current?.abort();

    if (!enabled) return;

    const uniqueMissing = new Map<string, AppShortcut>();
    for (const shortcut of shortcuts) {
      if (
        shortcut.path &&
        !shortcut.icon &&
        !iconsByPathRef.current[shortcut.path] &&
        !failedPathsRef.current.has(shortcut.path)
      ) {
        uniqueMissing.set(shortcut.path, shortcut);
      }
    }

    const missingShortcuts = Array.from(uniqueMissing.values());
    if (missingShortcuts.length === 0) return;

    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    void (async () => {
      for (let i = 0; i < missingShortcuts.length; i += BATCH_SIZE) {
        if (abortCtrl.signal.aborted) break;

        const batch = missingShortcuts.slice(i, i + BATCH_SIZE);
        const iconResults = await Promise.all(
          batch.map((shortcut) =>
            invoke<string | null>('get_app_icon', { path: shortcut.path }).catch(() => null)
          )
        );

        if (abortCtrl.signal.aborted) break;

        const nextIcons: Record<string, string> = {};
        const nextFailures = new Set<string>();

        batch.forEach((shortcut, index) => {
          const icon = iconResults[index];
          if (icon) {
            nextIcons[shortcut.path] = icon;
          } else {
            nextFailures.add(shortcut.path);
          }
        });

        if (Object.keys(nextIcons).length > 0) {
          setIconsByPath((prev) => ({ ...prev, ...nextIcons }));
        }
        if (nextFailures.size > 0) {
          setFailedPaths((prev) => new Set([...prev, ...nextFailures]));
        }
      }
    })();

    return () => {
      abortCtrl.abort();
    };
  }, [enabled, shortcuts]);

  const markIconFailed = useCallback((path: string) => {
    setFailedPaths((prev) => {
      if (prev.has(path)) return prev;
      return new Set(prev).add(path);
    });
  }, []);

  const getShortcutIconSrc = useCallback(
    (shortcut: AppShortcut) => {
      if (failedPaths.has(shortcut.path)) return undefined;
      const icon = shortcut.icon ?? iconsByPath[shortcut.path];
      return icon ? normalizeIconSrc(icon) : undefined;
    },
    [failedPaths, iconsByPath]
  );

  return { getShortcutIconSrc, markIconFailed };
}
