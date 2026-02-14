/**
 * Layout constants and helpers for transactions TUI rows.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

const TRANSACTIONS_CHROME_LINES = 18;

export function getTransactionsViewVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, TRANSACTIONS_CHROME_LINES);
}
