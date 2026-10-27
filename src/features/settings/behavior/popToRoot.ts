import type { PopToRootDelay } from '../types/settings.types';

/** Every "pop to root" delay, in the order the Settings page lists them. */
export const POP_TO_ROOT_OPTIONS: readonly PopToRootDelay[] = [
  'immediate',
  '30s',
  '1m',
  '5m',
  'never',
];

/** Hidden time after which the launcher reopens on the root view; `null` never does. */
const POP_TO_ROOT_DELAY_MS: Readonly<Record<PopToRootDelay, number | null>> = {
  immediate: 0,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 5 * 60_000,
  never: null,
};

export function isPopToRootDelay(value: unknown): value is PopToRootDelay {
  return typeof value === 'string' && (POP_TO_ROOT_OPTIONS as readonly string[]).includes(value);
}

/** Delay in milliseconds, or `null` when the launcher keeps its state forever. */
export function popToRootDelayMs(delay: PopToRootDelay | undefined): number | null {
  return POP_TO_ROOT_DELAY_MS[delay ?? 'never'] ?? null;
}

/**
 * Whether the query and the view must be reset when the launcher reopens after having been
 * hidden for `hiddenForMs`. `never` (the historical behaviour) always keeps the state.
 */
export function shouldPopToRoot(delay: PopToRootDelay | undefined, hiddenForMs: number): boolean {
  const limit = popToRootDelayMs(delay);
  if (limit === null) return false;
  return hiddenForMs >= limit;
}
