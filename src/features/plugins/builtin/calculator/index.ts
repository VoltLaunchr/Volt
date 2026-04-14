import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { copyToClipboard } from '../../utils/helpers';
import { detectQueryType, parseQuery } from './parsers/queryParser';
import { evaluateMathExpression } from './converters/math';
import { convertUnit } from './converters/units';
import {
  calculateCountdown,
  calculateDateArithmetic,
  calculateFutureWeekday,
} from './converters/dates';
import { convertTimezone, getCurrentTimeInZone } from './converters/timezone';
import { formatNumber, formatWithUnit } from './utils/formatting';
import { addToHistory } from './utils/history';
import type { SpecificQuery } from './types';

// Export the view component
export { CalculatorView } from './components/CalculatorView';

// Keywords that trigger the calculator shortcut
const CALCULATOR_KEYWORDS = ['calc', 'calculatrice', 'calculer', 'calculator', 'math'];

export class CalculatorPlugin implements Plugin {
  id = 'calculator';
  name = 'Calculator';
  description = 'Math, unit conversions, date calculations, and timezone conversions';
  enabled = true;

  /**
   * Check if query can be handled by calculator
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim();
    if (!query) return false;

    const lowerQuery = query.toLowerCase();

    // Check if it's a calculator keyword (open calculator view) - MUST check FIRST
    if (CALCULATOR_KEYWORDS.some((kw) => lowerQuery === kw || lowerQuery.startsWith(kw + ' '))) {
      return true;
    }

    // Delegate to parser for detection
    return detectQueryType(query) !== null;
  }

  /**
   * Match query and return results
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim();
    const lowerQuery = query.toLowerCase();

    // Check if it's just a calculator keyword - offer to open calculator view
    if (CALCULATOR_KEYWORDS.some((kw) => lowerQuery === kw)) {
      return [
        {
          id: 'calc-open-view',
          type: PluginResultType.Calculator,
          title: '🧮 Open Calculator',
          subtitle: 'Math, conversions, dates, and timezones',
          score: 100,
          data: {
            action: 'open-calculator-view',
          },
        },
      ];
    }

    // Parse query to determine type and extract parameters
    const parsed = parseQuery(query);
    if (!parsed) return null;

    // Delegate to appropriate handler based on query type
    switch (parsed.type) {
      case 'math':
        return this.handleMath(parsed);
      case 'unit':
        return this.handleUnitConversion(parsed);
      case 'date':
        return this.handleDateCalculation(parsed);
      case 'timezone':
        return this.handleTimezoneConversion(parsed);
      default:
        return null;
    }
  }

  /**
   * Execute when user selects a result
   */
  async execute(result: PluginResult): Promise<void> {
    // Handle "open calculator view" action
    if (result.data?.action === 'open-calculator-view') {
      // Dispatch custom event to open calculator view in App.tsx
      window.dispatchEvent(new CustomEvent('volt:open-calculator'));
      return;
    }

    const formatted = (result.data?.formatted as string) || result.title;
    const success = await copyToClipboard(formatted);

    if (success) {
      console.log(`✓ Copied to clipboard: ${formatted}`);

      // Add to history
      const queryType = result.data?.queryType as 'math' | 'unit' | 'date' | 'timezone';
      if (queryType) {
        const query = (result.data?.expression as string) || result.subtitle?.split(' = ')[0] || '';

        addToHistory({
          query,
          result: formatted,
          type: queryType,
        });
      }
    }
  }

  /**
   * Handle math expressions
   */
  private handleMath(parsed: SpecificQuery): PluginResult[] | null {
    if (parsed.type !== 'math') return null;

    const expression = parsed.params.expression;
    const result = evaluateMathExpression(expression);

    if (result === null) {
      return null;
    }

    const formatted = formatNumber(result);

    return [
      {
        id: `calc-math-${Date.now()}`,
        type: PluginResultType.Calculator,
        title: formatted,
        subtitle: `${expression} = ${formatted}`,
        score: 95,
        data: {
          queryType: 'math',
          expression,
          result,
          formatted,
        },
      },
    ];
  }

  /**
   * Handle unit conversions
   */
  private handleUnitConversion(parsed: SpecificQuery): PluginResult[] | null {
    if (parsed.type !== 'unit') return null;

    const { value, from, to } = parsed.params;

    // Convert the unit
    const result = convertUnit(value, from, to);

    if (!result) {
      return null; // Invalid conversion
    }

    // Format the result with unit
    const formatted = formatWithUnit(result.value, result.toUnit);
    const inputFormatted = formatWithUnit(value, from);

    return [
      {
        id: `calc-unit-${Date.now()}`,
        type: PluginResultType.Calculator,
        title: formatted,
        subtitle: `${inputFormatted} = ${formatted}`,
        score: 95,
        data: {
          queryType: 'unit',
          value,
          from,
          to,
          result: result.value,
          formatted,
          category: result.category,
        },
      },
    ];
  }

  /**
   * Handle date calculations
   */
  private handleDateCalculation(parsed: SpecificQuery): PluginResult[] | null {
    if (parsed.type !== 'date') return null;

    const { operation } = parsed.params;
    let result = null;

    switch (operation) {
      case 'countdown':
        result = calculateCountdown(parsed.params.target as string);
        break;
      case 'arithmetic': {
        const base = parsed.params.base as string;
        const unit = parsed.params.unit as string;
        if (
          (base === 'today' || base === 'tomorrow') &&
          (unit === 'day' || unit === 'week' || unit === 'month')
        ) {
          result = calculateDateArithmetic(
            base,
            parsed.params.operator as '+' | '-',
            parsed.params.amount as number,
            unit
          );
        }
        break;
      }
      case 'future_weekday': {
        const unit = parsed.params.unit as string;
        if (unit === 'week' || unit === 'month') {
          result = calculateFutureWeekday(
            parsed.params.weekday as string,
            parsed.params.amount as number,
            unit
          );
        }
        break;
      }
    }

    if (!result) {
      return null;
    }

    return [
      {
        id: `calc-date-${Date.now()}`,
        type: PluginResultType.Calculator,
        title: result.formatted,
        subtitle: result.description,
        score: 95,
        data: {
          queryType: 'date',
          operation,
          result: result.value,
          formatted: result.formatted,
          description: result.description,
        },
      },
    ];
  }

  /**
   * Handle timezone conversions
   */
  private handleTimezoneConversion(parsed: SpecificQuery): PluginResult[] | null {
    if (parsed.type !== 'timezone') return null;

    const { operation } = parsed.params;
    let result = null;

    switch (operation) {
      case 'convert':
        result = convertTimezone(
          parsed.params.time as string,
          parsed.params.fromZone as string,
          parsed.params.toZone as string
        );
        break;
      case 'current_time':
        result = getCurrentTimeInZone(parsed.params.zone as string);
        break;
    }

    if (!result) {
      return null;
    }

    return [
      {
        id: `calc-timezone-${Date.now()}`,
        type: PluginResultType.Calculator,
        title: result.formatted,
        subtitle: result.description,
        score: 95,
        badge: 'Time',
        data: {
          queryType: 'timezone',
          operation,
          formatted: result.formatted,
          description: result.description,
          timezone: result.timezone,
        },
      },
    ];
  }
}
