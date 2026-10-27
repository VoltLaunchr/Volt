/* eslint-disable react-refresh/only-export-components -- Upstream Bklit registry modules intentionally co-locate context providers and hooks to preserve their public API. */
// Bklit UI registry source: https://ui.bklit.com/r/ (adapted for Volt integration).
"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

interface ChartLegendHoverContextValue {
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
}

const ChartLegendHoverContext =
  createContext<ChartLegendHoverContextValue | null>(null);

export function ChartLegendHoverProvider({
  hoveredIndex,
  onHoverChange,
  children,
}: {
  hoveredIndex: number | null;
  onHoverChange: (index: number | null) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ hoveredIndex, setHoveredIndex: onHoverChange }),
    [hoveredIndex, onHoverChange]
  );

  return (
    <ChartLegendHoverContext.Provider value={value}>
      {children}
    </ChartLegendHoverContext.Provider>
  );
}

export function useChartLegendHover(): ChartLegendHoverContextValue {
  const context = useContext(ChartLegendHoverContext);
  return (
    context ?? {
      hoveredIndex: null,
      setHoveredIndex: () => {
        /* noop outside ChartLegendHoverProvider */
      },
    }
  );
}
