/**
 * Enhanced math expression evaluator
 * Supports:
 * - Basic operations: +, -, *, /, %, ^
 * - Scientific functions: sqrt, sin, cos, tan, log, ln, abs
 * - Constants: pi, e
 */

/**
 * Evaluate a mathematical expression with scientific functions support
 * @param expr The expression to evaluate
 * @returns The result or null if invalid
 */
export function evaluateMathExpression(expr: string): number | null {
  try {
    // Clean the expression
    let cleaned = expr.trim().replace(/\s+/g, '');

    // Replace constants
    cleaned = replaceConstants(cleaned);

    // Process scientific functions
    cleaned = processScientificFunctions(cleaned);

    // Only allow safe characters after processing (including 'e' for scientific notation)
    if (!/^[\d+\-*/.()%^e]+$/i.test(cleaned)) {
      return null;
    }

    // Prevent dangerous patterns
    if (cleaned.includes('//') || cleaned.includes('/*')) {
      return null;
    }

    // Validate balanced parentheses
    if (!hasBalancedParentheses(cleaned)) {
      return null;
    }

    // Use safe arithmetic parser instead of Function constructor
    // This prevents arbitrary code execution while supporting math operations
    const result = safeEvaluateArithmetic(cleaned);

    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Replace mathematical constants with their values
 */
function replaceConstants(expr: string): string {
  return expr.replace(/\bpi\b/gi, Math.PI.toString()).replace(/\be\b/gi, Math.E.toString());
}

/**
 * Process scientific functions and replace them with their computed values
 */
function processScientificFunctions(expr: string): string {
  let processed = expr;

  // Process functions multiple times to handle nested functions
  // e.g., sqrt(sin(45))
  let maxIterations = 10; // Prevent infinite loops
  let changed = true;

  while (changed && maxIterations-- > 0) {
    const before = processed;

    // sqrt(x)
    processed = processed.replace(/sqrt\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      return val !== null ? Math.sqrt(val).toString() : _match;
    });

    // sin(x) - expects degrees by default
    processed = processed.replace(/sin\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      if (val === null) return _match;
      const radians = (val * Math.PI) / 180;
      return Math.sin(radians).toString();
    });

    // cos(x) - expects degrees by default
    processed = processed.replace(/cos\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      if (val === null) return _match;
      const radians = (val * Math.PI) / 180;
      return Math.cos(radians).toString();
    });

    // tan(x) - expects degrees by default
    processed = processed.replace(/tan\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      if (val === null) return _match;
      const radians = (val * Math.PI) / 180;
      return Math.tan(radians).toString();
    });

    // log(x) - base 10
    processed = processed.replace(/log\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      return val !== null && val > 0 ? Math.log10(val).toString() : _match;
    });

    // ln(x) - natural log
    processed = processed.replace(/ln\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      return val !== null && val > 0 ? Math.log(val).toString() : _match;
    });

    // abs(x)
    processed = processed.replace(/abs\s*\(\s*([^()]+)\s*\)/gi, (_match, arg) => {
      const val = evaluateSimple(arg);
      return val !== null ? Math.abs(val).toString() : _match;
    });

    changed = processed !== before;
  }

  return processed;
}

/**
 * Evaluate a simple expression (no functions)
 * Used for evaluating function arguments
 */
function evaluateSimple(expr: string): number | null {
  try {
    const cleaned = expr.trim();

    // Allow only numbers, basic operators, and scientific notation (e)
    if (!/^[\d+\-*/.()%^e]+$/i.test(cleaned)) {
      return null;
    }

    // Validate balanced parentheses
    if (!hasBalancedParentheses(cleaned)) {
      return null;
    }

    // Use safe arithmetic parser
    const result = safeEvaluateArithmetic(cleaned);

    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that parentheses are balanced
 */
function hasBalancedParentheses(expr: string): boolean {
  let depth = 0;
  for (const char of expr) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Safe arithmetic expression parser using recursive descent
 * Supports: +, -, *, /, %, ^ (exponentiation)
 * No arbitrary code execution - only arithmetic operations
 */
function safeEvaluateArithmetic(expr: string): number {
  // Normalize exponentiation operator
  expr = expr.replace(/\^/g, '**');

  let pos = 0;

  // Tokenizer
  const peek = (): string => expr[pos] || '';
  const consume = (): string => expr[pos++] || '';
  const skipWhitespace = () => {
    while (peek() === ' ') consume();
  };

  // Parse number (including scientific notation like 1.23e-10)
  const parseNumber = (): number => {
    skipWhitespace();
    let num = '';

    // Handle negative numbers
    if (peek() === '-') {
      num += consume();
    }

    // Parse digits and decimal point
    while (/[\d.]/.test(peek())) {
      num += consume();
    }

    // Handle scientific notation (e.g., 1.23e-10, 5E+3)
    if (peek().toLowerCase() === 'e') {
      num += consume(); // 'e' or 'E'
      if (peek() === '+' || peek() === '-') {
        num += consume(); // optional sign
      }
      while (/\d/.test(peek())) {
        num += consume(); // exponent digits
      }
    }

    const value = parseFloat(num);
    if (isNaN(value)) {
      throw new Error('Invalid number');
    }
    return value;
  };

  // Parse factor (number or parenthesized expression)
  const parseFactor = (): number => {
    skipWhitespace();

    if (peek() === '(') {
      consume(); // '('
      const value = parseExpression();
      skipWhitespace();
      if (consume() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      return value;
    }

    return parseNumber();
  };

  // Parse exponentiation (highest precedence)
  const parseExponentiation = (): number => {
    let left = parseFactor();

    skipWhitespace();
    while (peek() === '*' && expr[pos + 1] === '*') {
      consume(); // First '*'
      consume(); // Second '*'
      const right = parseFactor(); // Right-associative
      left = Math.pow(left, right);
      skipWhitespace();
    }

    return left;
  };

  // Parse term (*, /, %)
  const parseTerm = (): number => {
    let left = parseExponentiation();

    skipWhitespace();
    while (peek() && '*/%'.includes(peek()) && !(peek() === '*' && expr[pos + 1] === '*')) {
      const op = consume();
      const right = parseExponentiation();

      if (op === '*') {
        left *= right;
      } else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else if (op === '%') {
        if (right === 0) throw new Error('Modulo by zero');
        left %= right;
      }

      skipWhitespace();
    }

    return left;
  };

  // Parse expression (+, -)
  const parseExpression = (): number => {
    let left = parseTerm();

    skipWhitespace();
    while (peek() && '+-'.includes(peek())) {
      const op = consume();
      const right = parseTerm();

      if (op === '+') {
        left += right;
      } else if (op === '-') {
        left -= right;
      }

      skipWhitespace();
    }

    return left;
  };

  // Start parsing
  const result = parseExpression();

  // Ensure we consumed the entire expression
  skipWhitespace();
  if (pos < expr.length) {
    throw new Error('Unexpected characters after expression');
  }

  return result;
}
