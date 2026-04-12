import { describe, it, expect } from 'vitest';
import { detectQueryType, parseQuery } from './queryParser';

describe('detectQueryType', () => {
  it('detects unit conversions', () => {
    expect(detectQueryType('32f to c')).toBe('unit');
    expect(detectQueryType('5 miles to km')).toBe('unit');
    expect(detectQueryType('100 kg in lbs')).toBe('unit');
  });

  it('detects math expressions', () => {
    expect(detectQueryType('2+2')).toBe('math');
    expect(detectQueryType('sqrt(16)')).toBe('math');
    expect(detectQueryType('(1+2)*3')).toBe('math');
  });

  it('detects countdown queries', () => {
    expect(detectQueryType('days until christmas')).toBe('date');
    expect(detectQueryType('until new year')).toBe('date');
  });

  it('detects date arithmetic', () => {
    expect(detectQueryType('today + 30 days')).toBe('date');
    expect(detectQueryType('tomorrow - 2 weeks')).toBe('date');
  });

  it('detects future weekdays', () => {
    expect(detectQueryType('monday in 3 weeks')).toBe('date');
  });

  it('detects timezone conversions', () => {
    expect(detectQueryType('5pm ldn in sf')).toBe('timezone');
    expect(detectQueryType('time in tokyo')).toBe('timezone');
  });

  it('returns null for non-calculator queries', () => {
    expect(detectQueryType('firefox')).toBe(null);
    expect(detectQueryType('')).toBe(null);
    expect(detectQueryType('   ')).toBe(null);
  });
});

describe('parseQuery', () => {
  it('extracts math expression', () => {
    const parsed = parseQuery('2 + 2');
    expect(parsed?.type).toBe('math');
    if (parsed?.type === 'math') {
      expect(parsed.params.expression).toBe('2 + 2');
    }
  });

  it('extracts unit conversion', () => {
    const parsed = parseQuery('32f to c');
    expect(parsed?.type).toBe('unit');
    if (parsed?.type === 'unit') {
      expect(parsed.params.value).toBe(32);
      expect(parsed.params.from).toBe('f');
      expect(parsed.params.to).toBe('c');
    }
  });

  it('extracts countdown target', () => {
    const parsed = parseQuery('days until christmas');
    expect(parsed?.type).toBe('date');
    if (parsed?.type === 'date') {
      expect(parsed.params.operation).toBe('countdown');
      expect(parsed.params.target).toBe('christmas');
    }
  });

  it('extracts date arithmetic parts', () => {
    const parsed = parseQuery('today + 30 days');
    expect(parsed?.type).toBe('date');
    if (parsed?.type === 'date') {
      expect(parsed.params.operation).toBe('arithmetic');
      expect(parsed.params.base).toBe('today');
      expect(parsed.params.operator).toBe('+');
      expect(parsed.params.amount).toBe(30);
      expect(parsed.params.unit).toBe('day');
    }
  });

  it('extracts timezone conversion', () => {
    const parsed = parseQuery('5pm ldn in sf');
    expect(parsed?.type).toBe('timezone');
    if (parsed?.type === 'timezone') {
      expect(parsed.params.operation).toBe('convert');
      expect(parsed.params.time).toBe('5pm');
      expect(parsed.params.fromZone).toBe('ldn');
      expect(parsed.params.toZone).toBe('sf');
    }
  });

  it('extracts current time zone', () => {
    const parsed = parseQuery('time in tokyo');
    expect(parsed?.type).toBe('timezone');
    if (parsed?.type === 'timezone') {
      expect(parsed.params.operation).toBe('current_time');
      expect(parsed.params.zone).toBe('tokyo');
    }
  });

  it('returns null for non-calc queries', () => {
    expect(parseQuery('firefox')).toBe(null);
  });
});
