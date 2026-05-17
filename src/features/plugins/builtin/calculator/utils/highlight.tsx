
type TokenKind = 'number' | 'operator' | 'function' | 'paren' | 'constant' | 'unit' | 'text';

interface Token {
  value: string;
  kind: TokenKind;
}

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt', 'log', 'ln', 'abs', 'floor', 'ceil', 'round', 'pow']);
const CONSTANTS = new Set(['pi', 'e', 'phi', 'inf', 'infinity']);
const UNITS = new Set([
  'px', 'rem', 'em', 'pt', 'pixel', 'pixels',
  'km', 'mi', 'miles', 'meter', 'meters', 'm', 'cm', 'mm', 'ft', 'feet', 'in', 'inch', 'inches', 'yard', 'yards',
  'kg', 'lb', 'lbs', 'gram', 'grams', 'g', 'oz', 'ounce', 'ounces', 'ton', 'tons',
  'celsius', 'fahrenheit', 'kelvin', 'c', 'f', 'k',
  'l', 'liter', 'liters', 'ml', 'gal', 'gallon', 'gallons', 'fl', 'oz',
  'to', 'in',
]);

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      tokens.push({ value: ch, kind: 'text' });
      i++;
      continue;
    }

    if (/[\d.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[\d.,]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push({ value: num, kind: 'number' });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let word = '';
      while (i < expr.length && /[a-zA-Z_]/.test(expr[i])) {
        word += expr[i++];
      }
      const lower = word.toLowerCase();
      let kind: TokenKind = 'text';
      if (FUNCTIONS.has(lower)) kind = 'function';
      else if (CONSTANTS.has(lower)) kind = 'constant';
      else if (UNITS.has(lower)) kind = 'unit';
      tokens.push({ value: word, kind });
      continue;
    }

    if (/[+\-*/%^=]/.test(ch)) {
      tokens.push({ value: ch, kind: 'operator' });
      i++;
      continue;
    }

    if (/[()[\]]/.test(ch)) {
      tokens.push({ value: ch, kind: 'paren' });
      i++;
      continue;
    }

    tokens.push({ value: ch, kind: 'text' });
    i++;
  }

  return tokens;
}

const TOKEN_CLASS: Record<TokenKind, string> = {
  number: 'text-on-dark',
  operator: 'text-stone-400',
  function: 'text-accent-blue',
  constant: 'text-accent-blue',
  paren: 'text-muted',
  unit: 'text-accent-green',
  text: 'text-body',
};

interface Props {
  expression: string;
  className?: string;
}

export function HighlightedExpression({ expression, className }: Props) {
  const tokens = tokenize(expression);
  return (
    <span className={className}>
      {tokens.map((token, idx) => (
        <span key={idx} className={TOKEN_CLASS[token.kind]}>
          {token.value}
        </span>
      ))}
    </span>
  );
}
