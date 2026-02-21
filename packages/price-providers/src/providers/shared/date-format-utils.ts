/**
 * Shared date formatting utilities for provider APIs.
 */

/**
 * Format a UTC date as YYYY-MM-DD.
 */
export function formatUtcDateYyyyMmDd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Format a UTC date as DD-MM-YYYY.
 */
export function formatUtcDateDdMmYyyy(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();

  return `${day}-${month}-${year}`;
}
