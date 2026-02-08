/**
 * Layout constants and helpers for accounts TUI rows.
 */

const ACCOUNTS_CHROME_LINES = 16;

export function getAccountsViewVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - ACCOUNTS_CHROME_LINES);
}
