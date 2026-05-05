import { useContext } from "react";
import { ChartContext } from "./chart-context-internal";
import type { ChartContextValue } from "./chart-context";

export function useChart(): ChartContextValue {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error(
      "useChart must be used within a ChartProvider. " +
        "Make sure your component is wrapped in <LineChart>, <AreaChart>, or <BarChart>."
    );
  }
  return context;
}
