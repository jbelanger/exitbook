/**
 * Format duration for display
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string (123ms, 12.3s, 2m 15s)
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }

  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format wait time for display (used in rate limit backoff messages)
 *
 * @param ms - Wait time in milliseconds
 * @returns Formatted wait time string (123ms, 12.3s)
 */
export function formatWaitTime(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
