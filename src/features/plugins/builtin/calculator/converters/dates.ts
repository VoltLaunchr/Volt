/**
 * Date calculation utilities
 * Supports: countdown, date arithmetic, future weekdays
 */

import {
  addDays,
  addWeeks,
  addMonths,
  differenceInDays,
  format,
  parse,
  nextMonday,
  nextTuesday,
  nextWednesday,
  nextThursday,
  nextFriday,
  nextSaturday,
  nextSunday,
  startOfDay,
} from 'date-fns';

export interface DateCalculationResult {
  type: 'countdown' | 'future_date' | 'duration';
  value: number | Date;
  formatted: string;
  description: string;
}

/**
 * Calculate countdown to a target date
 * Examples: "days until christmas", "until dec 25"
 */
export function calculateCountdown(targetDateStr: string): DateCalculationResult | null {
  try {
    const today = startOfDay(new Date());
    const targetDate = parseTargetDate(targetDateStr);

    if (!targetDate) {
      return null;
    }

    const days = differenceInDays(targetDate, today);

    // Format the result
    let description: string;
    if (days === 0) {
      description = 'Today';
    } else if (days === 1) {
      description = '1 day';
    } else if (days < 0) {
      description = `${Math.abs(days)} days ago`;
    } else {
      description = `${days} days`;
    }

    return {
      type: 'countdown',
      value: days,
      formatted: description,
      description: `${description} until ${format(targetDate, 'MMMM d, yyyy')}`,
    };
  } catch {
    return null;
  }
}

/**
 * Perform date arithmetic
 * Examples: "today + 30 days", "tomorrow - 5 weeks"
 */
export function calculateDateArithmetic(
  base: 'today' | 'tomorrow',
  operator: '+' | '-',
  amount: number,
  unit: 'day' | 'week' | 'month'
): DateCalculationResult | null {
  try {
    let startDate = startOfDay(new Date());

    // Adjust for tomorrow
    if (base === 'tomorrow') {
      startDate = addDays(startDate, 1);
    }

    // Perform the calculation
    let resultDate: Date;
    const adjustedAmount = operator === '-' ? -amount : amount;

    switch (unit) {
      case 'day':
        resultDate = addDays(startDate, adjustedAmount);
        break;
      case 'week':
        resultDate = addWeeks(startDate, adjustedAmount);
        break;
      case 'month':
        resultDate = addMonths(startDate, adjustedAmount);
        break;
      default:
        return null;
    }

    return {
      type: 'future_date',
      value: resultDate,
      formatted: format(resultDate, 'MMMM d, yyyy'),
      description: format(resultDate, 'EEEE, MMMM d, yyyy'),
    };
  } catch {
    return null;
  }
}

/**
 * Calculate future weekday
 * Examples: "monday in 3 weeks", "friday in 2 months"
 */
export function calculateFutureWeekday(
  weekday: string,
  amount: number,
  unit: 'week' | 'month'
): DateCalculationResult | null {
  try {
    const today = new Date();
    let targetDate: Date;

    // Get the next occurrence of the weekday
    switch (weekday.toLowerCase()) {
      case 'monday':
        targetDate = nextMonday(today);
        break;
      case 'tuesday':
        targetDate = nextTuesday(today);
        break;
      case 'wednesday':
        targetDate = nextWednesday(today);
        break;
      case 'thursday':
        targetDate = nextThursday(today);
        break;
      case 'friday':
        targetDate = nextFriday(today);
        break;
      case 'saturday':
        targetDate = nextSaturday(today);
        break;
      case 'sunday':
        targetDate = nextSunday(today);
        break;
      default:
        return null;
    }

    // Add the specified amount of weeks/months
    if (unit === 'week') {
      // Subtract 1 week because we already got the next occurrence
      targetDate = addWeeks(targetDate, amount - 1);
    } else if (unit === 'month') {
      targetDate = addMonths(targetDate, amount);
    }

    return {
      type: 'future_date',
      value: targetDate,
      formatted: format(targetDate, 'MMMM d, yyyy'),
      description: format(targetDate, 'EEEE, MMMM d, yyyy'),
    };
  } catch {
    return null;
  }
}

/**
 * Parse a target date string
 * Supports various formats: "christmas", "dec 25", "2025-12-25", etc.
 */
function parseTargetDate(dateStr: string): Date | null {
  const normalized = dateStr.toLowerCase().trim();
  const currentYear = new Date().getFullYear();

  // Common holidays
  const holidays: Record<string, string> = {
    christmas: `${currentYear}-12-25`,
    'new year': `${currentYear + 1}-01-01`,
    'new years': `${currentYear + 1}-01-01`,
    halloween: `${currentYear}-10-31`,
    valentine: `${currentYear}-02-14`,
    valentines: `${currentYear}-02-14`,
    easter: `${currentYear}-04-20`, // Approximate
    thanksgiving: `${currentYear}-11-28`, // Approximate (4th Thursday)
  };

  // Check for holidays
  if (holidays[normalized]) {
    return startOfDay(new Date(holidays[normalized]));
  }

  // Try parsing as ISO date (2025-12-25)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return startOfDay(new Date(normalized));
  }

  // Try parsing month/day formats: "dec 25", "december 25"
  const monthDayMatch = normalized.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (monthDayMatch) {
    const month = monthDayMatch[1];
    const day = parseInt(monthDayMatch[2]);

    const monthMap: Record<string, number> = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    const monthNum = monthMap[month];
    if (monthNum !== undefined) {
      const date = new Date(currentYear, monthNum, day);
      // If the date has passed this year, use next year
      if (date < new Date()) {
        return startOfDay(new Date(currentYear + 1, monthNum, day));
      }
      return startOfDay(date);
    }
  }

  // Try parsing with date-fns (various formats)
  try {
    // Try "MM/DD/YYYY"
    const parsed = parse(normalized, 'MM/dd/yyyy', new Date());
    if (!isNaN(parsed.getTime())) {
      return startOfDay(parsed);
    }
  } catch {
    // Continue to next attempt
  }

  try {
    // Try "MMMM d, yyyy" (e.g., "December 25, 2025")
    const parsed = parse(normalized, 'MMMM d, yyyy', new Date());
    if (!isNaN(parsed.getTime())) {
      return startOfDay(parsed);
    }
  } catch {
    // Continue to next attempt
  }

  // Fallback to native Date parsing
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return startOfDay(date);
    }
  } catch {
    // Failed to parse
  }

  return null;
}
