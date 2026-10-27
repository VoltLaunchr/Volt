import type { PopToRootDelay } from '../features/settings/types/settings.types';
import { shouldPopToRoot } from '../features/settings/behavior/popToRoot';

/**
 * Remembers when the launcher was hidden and answers, once it is shown again, whether the
 * configured delay elapsed (so the query and the view must be reset).
 *
 * Both signals the webview gives (focus loss and visibility change) feed the same tracker, so
 * only the first "hidden" mark of a hide/show cycle counts and the first "shown" consumes it.
 */
export class PopToRootTracker {
  private hiddenAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** The launcher went away. Keeps the earliest mark of the current hidden period. */
  markHidden(at: number = this.now()): void {
    if (this.hiddenAt === null) this.hiddenAt = at;
  }

  /** The launcher is shown again: returns whether it must pop back to the root view. */
  consumeShown(delay: PopToRootDelay | undefined): boolean {
    if (this.hiddenAt === null) return false;
    const hiddenForMs = Math.max(0, this.now() - this.hiddenAt);
    this.hiddenAt = null;
    return shouldPopToRoot(delay, hiddenForMs);
  }

  /** Forgets a pending hide (the launcher was never really hidden). */
  cancel(): void {
    this.hiddenAt = null;
  }
}
