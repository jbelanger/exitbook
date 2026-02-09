/**
 * Layout constants and helpers for providers TUI rows.
 */

const PROVIDERS_CHROME_LINES = 18;

export function getProvidersViewVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - PROVIDERS_CHROME_LINES);
}
