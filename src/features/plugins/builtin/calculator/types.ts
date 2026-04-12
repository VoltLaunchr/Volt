/**
 * Calculator plugin types
 */

export type QueryType = 'math' | 'unit' | 'date' | 'timezone';

export interface ParsedQuery {
  type: QueryType;
  raw: string;
  params: Record<string, unknown>;
}

export interface MathQuery {
  type: 'math';
  raw: string;
  params: {
    expression: string;
  };
}

export interface UnitQuery {
  type: 'unit';
  raw: string;
  params: {
    value: number;
    from: string;
    to: string;
  };
}

export interface DateQuery {
  type: 'date';
  raw: string;
  params: {
    operation: 'countdown' | 'arithmetic' | 'future_weekday';
    [key: string]: unknown;
  };
}

export interface TimezoneQuery {
  type: 'timezone';
  raw: string;
  params: {
    operation: 'convert' | 'current_time';
    [key: string]: unknown;
  };
}

export type SpecificQuery = MathQuery | UnitQuery | DateQuery | TimezoneQuery;
