import type { PriceGranularity } from '../core/types.js';

/**
 * Round timestamp to nearest day (for daily price lookups).
 */
export function roundToDay(date: Date): Date {
  const rounded = new Date(date);
  rounded.setUTCHours(0, 0, 0, 0);
  return rounded;
}

/**
 * Round timestamp to nearest hour (for hourly price lookups).
 */
export function roundToHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setUTCMinutes(0, 0, 0);
  return rounded;
}

/**
 * Round timestamp to nearest minute (for minute-level price lookups).
 */
export function roundToMinute(date: Date): Date {
  const rounded = new Date(date);
  rounded.setUTCSeconds(0, 0);
  return rounded;
}

/**
 * Round timestamp based on price granularity.
 */
export function roundTimestampByGranularity(date: Date, granularity: PriceGranularity | undefined): Date {
  if (granularity === 'exact') {
    return date;
  }

  if (granularity === 'day') {
    return roundToDay(date);
  }

  if (granularity === 'hour') {
    return roundToHour(date);
  }

  if (granularity === 'minute') {
    return roundToMinute(date);
  }

  return date;
}

/**
 * Check if two timestamps are on the same UTC day.
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}
