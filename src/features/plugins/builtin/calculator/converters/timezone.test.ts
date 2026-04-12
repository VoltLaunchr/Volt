import { describe, it, expect } from 'vitest';
import { convertTimezone, getCurrentTimeInZone } from './timezone';

describe('timezone converters', () => {
  describe('convertTimezone', () => {
    it('converts 5pm London to San Francisco', () => {
      const result = convertTimezone('5pm', 'ldn', 'sf');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('convert');
      expect(result!.timezone).toBe('America/Los_Angeles');
      expect(result!.formatted).toMatch(/^\d{2}:\d{2}$/);
    });

    it('supports 24h time format', () => {
      const result = convertTimezone('14:30', 'tokyo', 'nyc');
      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('America/New_York');
    });

    it('returns null for invalid source zone', () => {
      expect(convertTimezone('5pm', 'marsbase', 'sf')).toBeNull();
    });

    it('returns null for invalid target zone', () => {
      expect(convertTimezone('5pm', 'ldn', 'unknownplace')).toBeNull();
    });

    it('returns null for invalid time format', () => {
      expect(convertTimezone('pizza', 'ldn', 'sf')).toBeNull();
    });

    it('accepts full IANA timezone names', () => {
      const result = convertTimezone('10am', 'Europe/Paris', 'Asia/Tokyo');
      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('Asia/Tokyo');
    });

    it('handles 12am (midnight)', () => {
      const result = convertTimezone('12am', 'utc', 'tokyo');
      expect(result).not.toBeNull();
    });

    it('handles 12pm (noon)', () => {
      const result = convertTimezone('12pm', 'utc', 'nyc');
      expect(result).not.toBeNull();
    });
  });

  describe('getCurrentTimeInZone', () => {
    it('returns current time for tokyo', () => {
      const result = getCurrentTimeInZone('tokyo');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('current_time');
      expect(result!.timezone).toBe('Asia/Tokyo');
      expect(result!.formatted).toMatch(/^\d{2}:\d{2}$/);
    });

    it('returns null for unknown zone', () => {
      expect(getCurrentTimeInZone('atlantis')).toBeNull();
    });

    it('handles UTC', () => {
      const result = getCurrentTimeInZone('utc');
      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('UTC');
    });
  });
});
