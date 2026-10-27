import { invoke } from '@tauri-apps/api/core';

const CAPACITY = 128;
const SUCCESS_TTL = 300_000;
const FAILURE_TTL = 30_000;
type Entry = { promise: Promise<string | null>; expires: number; pending: boolean };
const icons = new Map<string, Entry>();

/** Reuse completed AND in-flight requests across list remounts in this webview. The native
 * cache shares the actual extraction across webviews and bounds the worker count globally. */
export function loadAppIcon(path: string): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  const cached = icons.get(path);
  if (cached && (cached.pending || cached.expires > Date.now())) {
    icons.delete(path);
    icons.set(path, cached);
    return cached.promise;
  }
  icons.delete(path);
  if (icons.size >= CAPACITY) {
    const oldest = [...icons].find(([, entry]) => !entry.pending);
    if (!oldest) return Promise.resolve(null);
    icons.delete(oldest[0]);
  }
  const entry: Entry = {
    promise: Promise.resolve(null),
    expires: 0,
    pending: true,
  };
  entry.promise = invoke<string | null>('get_app_icon', { path })
    .catch(() => null)
    .then((icon) => {
      entry.pending = false;
      entry.expires = Date.now() + (icon ? SUCCESS_TTL : FAILURE_TTL);
      return icon;
    });
  icons.set(path, entry);
  return entry.promise;
}
