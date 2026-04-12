import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateCountdown,
  calculateDateArithmetic,
  calculateFutureWeekday,
} from './dates';

describe('date calculators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateCountdown', () => {
    it('returns countdown to a holiday', () => {
      const result = calculateCountdown('christmas');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('countdown');
      expect(typeof result!.value).toBe('number');
      expect(result!.formatted).toMatch(/day/);
    });

    it('handles ISO date format', () => {
      const result = calculateCountdown('2026-05-01');
      expect(result).not.toBeNull();
      expect(result!.value).toBeGreaterThan(0);
    });

    it('parses "dec 25" month-day format', () => {
      const result = calculateCountdown('dec 25');
      expect(result).not.toBeNull();
      expect(result!.formatted).toMatch(/day/);
    });

    it('handles "new year"', () => {
      const result = calculateCountdown('new year');
      expect(result).not.toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(calculateCountdown('not-a-date-ever-nope')).toBeNull();
    });
  });

  describe('calculateDateArithmetic', () => {
    it('adds days to today', () => {
      const result = calculateDateArithmetic('today', '+', 10, 'day');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('future_date');
      expect(result!.formatted).toMatch(/April 22, 2026|April 22|2026/);
    });

    it('subtracts weeks from today', () => {
      const result = calculateDateArithmetic('today', '-', 1, 'week');
      expect(result).not.toBeNull();
      expect(result!.formatted).toMatch(/April 5, 2026|2026/);
    });

    it('adds months to tomorrow', () => {
      const result = calculateDateArithmetic('tomorrow', '+', 2, 'month');
      expect(result).not.toBeNull();
      expect(result!.formatted).toMatch(/June 13|2026/);
    });
  });

  describe('calculateFutureWeekday', () => {
    it('returns a future monday', () => {
      const result = calculateFutureWeekday('monday', 1, 'week');
      expect(result).not.toBeNull();
      expect(result!.description.toLowerCase()).toContain('monday');
    });

    it('handles "friday in 2 months"', () => {
      const result = calculateFutureWeekday('friday', 2, 'month');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('future_date');
      expect(result!.formatted).toBeTruthy();
    });

    it('returns null for unknown weekday', () => {
      expect(calculateFutureWeekday('noday', 1, 'week')).toBeNull();
    });
  });
});
