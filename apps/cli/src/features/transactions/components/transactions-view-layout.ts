/**
 * Layout constants and helpers for transactions TUI rows.
 */

const TRANSACTIONS_CHROME_LINES = 18;

export function getTransactionsViewVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - TRANSACTIONS_CHROME_LINES);
}
