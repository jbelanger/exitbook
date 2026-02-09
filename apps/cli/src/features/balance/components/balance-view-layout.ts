/**
 * Layout constants and helpers for balance TUI rows.
 */

const BALANCE_ACCOUNTS_CHROME_LINES = 16;
const BALANCE_ASSETS_CHROME_LINES = 16;

export function getBalanceAccountsVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - BALANCE_ACCOUNTS_CHROME_LINES);
}

export function getBalanceAssetsVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - BALANCE_ASSETS_CHROME_LINES);
}
