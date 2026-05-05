export type Momentum = "up" | "down" | "flat";

export interface MomentumColors {
  up: string;
  down: string;
  flat: string;
}

export function detectMomentum(
  data: Record<string, unknown>[],
  dataKey: string,
  lookback = 20
): Momentum {
  if (data.length < 5) {
    return "flat";
  }
  const start = Math.max(0, data.length - lookback);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = start; i < data.length; i++) {
    const v = data[i]?.[dataKey];
    if (typeof v === "number") {
      if (v < min) {
        min = v;
      }
      if (v > max) {
        max = v;
      }
    }
  }
  const range = max - min;
  if (range === 0) {
    return "flat";
  }
  const tailStart = Math.max(start, data.length - 5);
  const firstRaw = data[tailStart]?.[dataKey];
  const lastRaw = data.at(-1)?.[dataKey];
  const first = typeof firstRaw === "number" ? firstRaw : 0;
  const last = typeof lastRaw === "number" ? lastRaw : 0;
  const delta = last - first;
  const threshold = range * 0.12;
  if (delta > threshold) {
    return "up";
  }
  if (delta < -threshold) {
    return "down";
  }
  return "flat";
}
