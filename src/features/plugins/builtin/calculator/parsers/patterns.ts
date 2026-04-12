/**
 * Regex patterns for query detection
 */

export const PATTERNS = {
  // Unit conversions: "32f to c", "5 miles in km", "150 lbs to kg"
  unit: /^(\d+(?:\.\d+)?)\s*([a-z°]+)\s+(?:in|to)\s+([a-z°]+)$/i,

  // Date calculations
  countdown: /^(?:days?\s+)?(?:until|to)\s+(.+)$/i, // "days until christmas"
  dateArithmetic: /^(today|tomorrow)\s*([+-])\s*(\d+)\s*(days?|weeks?|months?)$/i, // "today + 30 days"
  futureWeekday:
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+in\s+(\d+)\s+(weeks?|months?)$/i, // "monday in 3 weeks"

  // Timezone conversions
  timeConversion: /^(\d+(?::\d{2})?\s*(?:am|pm)?)\s+([a-z]{2,})\s+(?:in|to)\s+([a-z]{2,})$/i, // "5pm ldn in sf"
  currentTime: /^time\s+(?:in\s+)?([a-z][a-z\s]*)$/i, // "time in tokyo" - MUST start with "time"

  // Math expressions (fallback)
  // Enhanced to support scientific functions and constants
  math: /^[\d+\-*/.()%^√\s]+(sin|cos|tan|log|ln|sqrt|abs|pi|e)?[\d+\-*/.()%^√\s]*$/i,

  // Scientific functions
  scientificFunction: /(sqrt|sin|cos|tan|log|ln|abs)\s*\(\s*([^)]+)\s*\)/gi,

  // Constants
  constants: /\b(pi|e)\b/gi,
};

/**
 * Check if query matches any date pattern
 */
export function isDateQuery(query: string): boolean {
  return (
    PATTERNS.countdown.test(query) ||
    PATTERNS.dateArithmetic.test(query) ||
    PATTERNS.futureWeekday.test(query)
  );
}

/**
 * Check if query matches any timezone pattern
 */
export function isTimezoneQuery(query: string): boolean {
  return PATTERNS.timeConversion.test(query) || PATTERNS.currentTime.test(query);
}
