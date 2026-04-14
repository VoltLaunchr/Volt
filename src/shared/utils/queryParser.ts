/**
 * Power-user query parser for search operators.
 *
 * Supports:
 * - ext:pdf       → filter by file extension
 * - in:~/Documents → filter by directory
 * - size:>10mb    → filter by minimum file size
 * - size:<1gb     → filter by maximum file size
 * - modified:<7d  → files modified within last 7 days
 * - modified:>30d → files modified more than 30 days ago
 */

export interface QueryOperators {
  ext?: string;
  dir?: string;
  sizeMin?: number;
  sizeMax?: number;
  modifiedAfter?: number;
  modifiedBefore?: number;
}

export interface ParsedQuery {
  searchQuery: string;
  operators: QueryOperators;
  hasOperators: boolean;
}

const OPERATOR_REGEX = /\b(ext|in|size|modified):(\S+)/g;

function parseSize(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/i);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
  };

  return Math.round(num * (multipliers[unit] || 1));
}

function parseDuration(value: string): number | null {
  const match = value.match(/^(\d+)(h|d|w|m|y)$/i);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const seconds: Record<string, number> = {
    h: 3600,
    d: 86400,
    w: 604800,
    m: 2592000,
    y: 31536000,
  };

  return num * (seconds[unit] || 0);
}

export function parseQuery(raw: string): ParsedQuery {
  const operators: QueryOperators = {};
  let hasOperators = false;

  const searchQuery = raw.replace(OPERATOR_REGEX, (_, op: string, val: string) => {
    const operator = op.toLowerCase();

    if (operator === 'ext') {
      operators.ext = val.replace(/^\./, ''); // strip leading dot
      hasOperators = true;
    } else if (operator === 'in') {
      // Expand ~ to home dir (handled by backend, pass as-is)
      operators.dir = val;
      hasOperators = true;
    } else if (operator === 'size') {
      const gtMatch = val.match(/^>(.+)$/);
      const ltMatch = val.match(/^<(.+)$/);
      if (gtMatch) {
        const bytes = parseSize(gtMatch[1]);
        if (bytes !== null) {
          operators.sizeMin = bytes;
          hasOperators = true;
        }
      } else if (ltMatch) {
        const bytes = parseSize(ltMatch[1]);
        if (bytes !== null) {
          operators.sizeMax = bytes;
          hasOperators = true;
        }
      }
    } else if (operator === 'modified') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const ltMatch = val.match(/^<(.+)$/); // modified:<7d = within last 7 days
      const gtMatch = val.match(/^>(.+)$/); // modified:>30d = older than 30 days
      if (ltMatch) {
        const seconds = parseDuration(ltMatch[1]);
        if (seconds !== null) {
          operators.modifiedAfter = nowSeconds - seconds;
          hasOperators = true;
        }
      } else if (gtMatch) {
        const seconds = parseDuration(gtMatch[1]);
        if (seconds !== null) {
          operators.modifiedBefore = nowSeconds - seconds;
          hasOperators = true;
        }
      }
    }

    return ''; // strip operator from query
  }).trim().replace(/\s+/g, ' ');

  return { searchQuery, operators, hasOperators };
}
