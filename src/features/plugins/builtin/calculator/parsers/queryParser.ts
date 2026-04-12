/**
 * Query parser - detects and parses different types of calculator queries
 */

import { PATTERNS, isDateQuery, isTimezoneQuery } from './patterns';
import type { QueryType, SpecificQuery } from '../types';

/**
 * Detect the type of query
 * Order matters: more specific patterns first
 */
export function detectQueryType(query: string): QueryType | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Check unit conversion (most specific)
  if (PATTERNS.unit.test(trimmed)) return 'unit';

  // Check date calculations
  if (isDateQuery(trimmed)) return 'date';

  // Check timezone conversions
  if (isTimezoneQuery(trimmed)) return 'timezone';

  // Check math expression (least specific, fallback)
  if (isMathExpression(trimmed)) return 'math';

  return null;
}

/**
 * Parse the query and extract parameters
 */
export function parseQuery(query: string): SpecificQuery | null {
  const type = detectQueryType(query);
  if (!type) return null;

  switch (type) {
    case 'unit':
      return parseUnitQuery(query);
    case 'date':
      return parseDateQuery(query);
    case 'timezone':
      return parseTimezoneQuery(query);
    case 'math':
      return parseMathQuery(query);
  }
}

/**
 * Parse unit conversion query
 * Example: "32f to c" → { value: 32, from: 'f', to: 'c' }
 */
function parseUnitQuery(query: string): SpecificQuery | null {
  const match = query.trim().match(PATTERNS.unit);
  if (!match) return null;

  return {
    type: 'unit',
    raw: query,
    params: {
      value: parseFloat(match[1]),
      from: match[2].toLowerCase(),
      to: match[3].toLowerCase(),
    },
  };
}

/**
 * Parse date calculation query
 * Supports: countdown, arithmetic, future weekday
 */
function parseDateQuery(query: string): SpecificQuery | null {
  const trimmed = query.trim();

  // Countdown: "days until christmas"
  const countdownMatch = trimmed.match(PATTERNS.countdown);
  if (countdownMatch) {
    return {
      type: 'date',
      raw: query,
      params: {
        operation: 'countdown',
        target: countdownMatch[1].trim(),
      },
    };
  }

  // Date arithmetic: "today + 30 days"
  const arithmeticMatch = trimmed.match(PATTERNS.dateArithmetic);
  if (arithmeticMatch) {
    return {
      type: 'date',
      raw: query,
      params: {
        operation: 'arithmetic',
        base: arithmeticMatch[1], // today or tomorrow
        operator: arithmeticMatch[2], // + or -
        amount: parseInt(arithmeticMatch[3]),
        unit: arithmeticMatch[4].toLowerCase().replace(/s$/, ''), // days → day
      },
    };
  }

  // Future weekday: "monday in 3 weeks"
  const weekdayMatch = trimmed.match(PATTERNS.futureWeekday);
  if (weekdayMatch) {
    return {
      type: 'date',
      raw: query,
      params: {
        operation: 'future_weekday',
        weekday: weekdayMatch[1].toLowerCase(),
        amount: parseInt(weekdayMatch[2]),
        unit: weekdayMatch[3].toLowerCase().replace(/s$/, ''),
      },
    };
  }

  return null;
}

/**
 * Parse timezone conversion query
 * Supports: time conversion, current time
 */
function parseTimezoneQuery(query: string): SpecificQuery | null {
  const trimmed = query.trim();

  // Time conversion: "5pm ldn in sf"
  const conversionMatch = trimmed.match(PATTERNS.timeConversion);
  if (conversionMatch) {
    return {
      type: 'timezone',
      raw: query,
      params: {
        operation: 'convert',
        time: conversionMatch[1].trim(),
        fromZone: conversionMatch[2].toLowerCase(),
        toZone: conversionMatch[3].toLowerCase(),
      },
    };
  }

  // Current time: "time in tokyo"
  const currentTimeMatch = trimmed.match(PATTERNS.currentTime);
  if (currentTimeMatch) {
    return {
      type: 'timezone',
      raw: query,
      params: {
        operation: 'current_time',
        zone: currentTimeMatch[1].trim().toLowerCase(),
      },
    };
  }

  return null;
}

/**
 * Parse math expression query
 * Example: "2 + 2", "sqrt(16)", "sin(45)"
 */
function parseMathQuery(query: string): SpecificQuery | null {
  const trimmed = query.trim();

  if (!isMathExpression(trimmed)) return null;

  return {
    type: 'math',
    raw: query,
    params: {
      expression: trimmed,
    },
  };
}

/**
 * Check if a string is a valid math expression
 */
function isMathExpression(expr: string): boolean {
  const cleaned = expr.trim().replace(/\s+/g, '');

  // Must contain at least one digit
  if (!/\d/.test(cleaned)) return false;

  // Check if it contains operators or scientific functions
  const hasOperator = /[+\-*/.%^()]/.test(cleaned);
  const hasFunction = /sqrt|sin|cos|tan|log|ln|abs/i.test(cleaned);
  const hasConstant = /\b(pi|e)\b/i.test(cleaned);

  // Either has operator, function, or constant (with digits)
  return hasOperator || hasFunction || hasConstant;
}
