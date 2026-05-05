import { createContext } from "react";
import type { ChartContextValue } from "./chart-context";

/**
 * React context object backing `ChartProvider` and `useChart`.
 *
 * Lives in its own file so neither `chart-context.tsx` (component-only,
 * Fast Refresh) nor `use-chart.ts` (hook-only, Fast Refresh) needs to export
 * a non-component value.
 */
export const ChartContext = createContext<ChartContextValue | null>(null);
