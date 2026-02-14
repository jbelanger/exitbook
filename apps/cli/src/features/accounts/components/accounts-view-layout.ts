/**
 * Layout constants and helpers for accounts TUI rows.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

const ACCOUNTS_CHROME_LINES = 16;

export function getAccountsViewVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, ACCOUNTS_CHROME_LINES);
}
