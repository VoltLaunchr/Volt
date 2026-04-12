/**
 * Formatting utilities for calculator results
 */

/**
 * Format a number for display with locale awareness
 */
export function formatNumber(num: number, options?: Intl.NumberFormatOptions): string {
  // For very large or very small numbers, use exponential notation
  if (Math.abs(num) >= 1e9 || (Math.abs(num) < 1e-6 && num !== 0)) {
    return num.toExponential(6);
  }

  // Round to 10 decimal places to avoid floating point issues
  const rounded = Math.round(num * 1e10) / 1e10;

  // Use Intl.NumberFormat for locale-aware formatting
  try {
    const formatter = new Intl.NumberFormat(navigator.language, {
      maximumFractionDigits: 10,
      useGrouping: false, // Don't use grouping by default (1000 not 1,000)
      ...options,
    });
    return formatter.format(rounded);
  } catch {
    // Fallback to toString if Intl fails
    return rounded.toString();
  }
}

/**
 * Format a number with units
 */
export function formatWithUnit(num: number, unit: string): string {
  const formatted = formatNumber(num);

  // Special formatting for temperature
  if (unit === 'c' || unit === 'f' || unit === 'k') {
    return `${formatted}°${unit.toUpperCase()}`;
  }

  // Add space before unit for most cases
  return `${formatted} ${unit}`;
}

/**
 * Format a date for display
 * Will be enhanced in Phase 3
 */
export function formatDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat(navigator.language, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * Format a time with timezone
 * Will be enhanced in Phase 4
 */
export function formatTime(date: Date, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat(navigator.language, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(timezone && { timeZone: timezone }),
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}
