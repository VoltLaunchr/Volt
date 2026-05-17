/**
 * Tiny standalone debounce. The project doesn't bundle lodash, so we keep
 * this leaf-level so any feature can import it without dragging the editor
 * surface along.
 *
 * Note: `cancel()` is intentionally not part of the public signature — keep
 * the wrapper to a plain function so consumers stay on the typed contract.
 * Wire your own cleanup via the returned reference if you need to flush.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
