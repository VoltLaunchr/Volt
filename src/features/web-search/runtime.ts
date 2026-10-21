import { BraveSearchProvider } from './providers/braveSearchProvider';
import { WebSearchHistory } from './history';

/** Shared runtime instances: short-lived cache/provider state and opt-in history. */
export const braveSearchProvider = new BraveSearchProvider();
export const webSearchHistory = new WebSearchHistory({ enabled: false });
