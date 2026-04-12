/**
 * Timezone conversion utilities
 * Supports: time conversion between zones, current time in zones
 */

import { formatInTimeZone } from 'date-fns-tz';
import { logger } from '../../../../../shared/utils/logger';

export interface TimezoneConversionResult {
  type: 'convert' | 'current_time';
  formatted: string;
  description: string;
  timezone: string;
}

/**
 * Map of common timezone abbreviations and city names to IANA timezone names
 */
const TIMEZONE_MAP: Record<string, string> = {
  // Major cities
  london: 'Europe/London',
  ldn: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  rome: 'Europe/Rome',
  madrid: 'Europe/Madrid',
  amsterdam: 'Europe/Amsterdam',
  brussels: 'Europe/Brussels',
  vienna: 'Europe/Vienna',
  zurich: 'Europe/Zurich',
  moscow: 'Europe/Moscow',
  dubai: 'Asia/Dubai',
  tokyo: 'Asia/Tokyo',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong',
  hongkong: 'Asia/Hong_Kong',
  hk: 'Asia/Hong_Kong',
  singapore: 'Asia/Singapore',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  bangkok: 'Asia/Bangkok',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  auckland: 'Pacific/Auckland',
  'new york': 'America/New_York',
  newyork: 'America/New_York',
  nyc: 'America/New_York',
  ny: 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  losangeles: 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  sanfrancisco: 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  dallas: 'America/Chicago',
  denver: 'America/Denver',
  phoenix: 'America/Phoenix',
  seattle: 'America/Los_Angeles',
  boston: 'America/New_York',
  miami: 'America/New_York',
  toronto: 'America/Toronto',
  vancouver: 'America/Vancouver',
  montreal: 'America/Montreal',
  'mexico city': 'America/Mexico_City',
  mexicocity: 'America/Mexico_City',
  'sao paulo': 'America/Sao_Paulo',
  saopaulo: 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  buenosaires: 'America/Argentina/Buenos_Aires',

  // Common abbreviations
  utc: 'UTC',
  gmt: 'Europe/London',
  est: 'America/New_York',
  edt: 'America/New_York',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  bst: 'Europe/London',
  cet: 'Europe/Paris',
  cest: 'Europe/Paris',
  eet: 'Europe/Helsinki',
  eest: 'Europe/Helsinki',
  jst: 'Asia/Tokyo',
  ist: 'Asia/Kolkata',
  aest: 'Australia/Sydney',
  aedt: 'Australia/Sydney',
  nzst: 'Pacific/Auckland',
  nzdt: 'Pacific/Auckland',
};

/**
 * Convert time from one timezone to another
 * Example: "5pm ldn in sf" → "09:00 AM PST"
 */
export function convertTimezone(
  timeStr: string,
  fromZone: string,
  toZone: string
): TimezoneConversionResult | null {
  try {
    const fromTz = resolveTimezone(fromZone);
    const toTz = resolveTimezone(toZone);

    if (!fromTz || !toTz) {
      return null;
    }

    // Parse the time string
    const parsedTime = parseTimeString(timeStr);
    if (!parsedTime) {
      return null;
    }

    // Create a date in the source timezone
    const now = new Date();
    const sourceDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      parsedTime.hours,
      parsedTime.minutes
    );

    // Format in the target timezone
    const formatted = formatInTimeZone(sourceDate, toTz, 'HH:mm');
    const formattedLong = formatInTimeZone(sourceDate, toTz, 'h:mm a zzz');

    return {
      type: 'convert',
      formatted,
      description: `${timeStr} ${fromZone} = ${formattedLong}`,
      timezone: toTz,
    };
  } catch (error) {
    logger.error('Timezone conversion error:', error);
    return null;
  }
}

/**
 * Get current time in a timezone
 * Example: "time in tokyo" → current time in Tokyo
 */
export function getCurrentTimeInZone(zone: string): TimezoneConversionResult | null {
  try {
    const timezone = resolveTimezone(zone);
    if (!timezone) {
      return null;
    }

    const now = new Date();
    const formatted = formatInTimeZone(now, timezone, 'HH:mm');
    const formattedLong = formatInTimeZone(now, timezone, 'h:mm a zzz');
    const date = formatInTimeZone(now, timezone, 'EEEE, MMMM d');

    return {
      type: 'current_time',
      formatted,
      description: `${formattedLong} - ${date}`,
      timezone,
    };
  } catch (error) {
    logger.error('Current time error:', error);
    return null;
  }
}

/**
 * Resolve a timezone string to IANA timezone name
 */
function resolveTimezone(zone: string): string | null {
  const normalized = zone.toLowerCase().trim();

  // Direct lookup
  if (TIMEZONE_MAP[normalized]) {
    return TIMEZONE_MAP[normalized];
  }

  // Check if it's already a valid IANA timezone
  // (e.g., "America/New_York")
  if (zone.includes('/')) {
    return zone;
  }

  return null;
}

/**
 * Parse a time string into hours and minutes
 * Supports: "5pm", "17:00", "5:30pm", "14:30"
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  const normalized = timeStr.toLowerCase().trim();

  // Try parsing "5pm" or "5:30pm"
  const ampmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1]);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
    const period = ampmMatch[3];

    if (period === 'pm' && hours !== 12) {
      hours += 12;
    } else if (period === 'am' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  // Try parsing "17:00" or "14:30"
  const time24Match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (time24Match) {
    const hours = parseInt(time24Match[1]);
    const minutes = parseInt(time24Match[2]);

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return { hours, minutes };
    }
  }

  return null;
}

/**
 * Get all supported timezone abbreviations and cities
 */
export function getSupportedTimezones(): string[] {
  return Object.keys(TIMEZONE_MAP);
}
