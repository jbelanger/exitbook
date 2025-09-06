/**
 * Security utilities for sanitizing inputs to prevent attacks
 */

/**
 * Sanitize error messages to prevent Regular Expression Denial of Service (ReDoS) attacks
 * Removes potentially dangerous regex metacharacters that could be exploited
 *
 * @param message - The error message to sanitize
 * @returns Sanitized message with only safe characters
 */
export function sanitizeErrorMessage(message: string): string {
  // Remove regex metacharacters that could be used in ReDoS attacks
  // Keep only alphanumeric, spaces, basic punctuation
  return message.replace(/[^a-zA-Z0-9\s.,!?:;()-]/g, '');
}

/**
 * Sanitize currency ticker to ensure it contains only valid characters
 * Prevents injection attacks through currency identifiers
 *
 * @param ticker - Currency ticker to sanitize
 * @returns Sanitized ticker with only alphanumeric characters
 */
export function sanitizeCurrencyTicker(ticker: string): string {
  return ticker.replace(/[^A-Z0-9]/g, '');
}
