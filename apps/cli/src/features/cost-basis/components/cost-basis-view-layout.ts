/**
 * Layout constants and helpers for cost basis TUI rows.
 */

const COST_BASIS_ASSETS_CHROME_LINES = 20;
const COST_BASIS_DISPOSALS_CHROME_LINES = 16;

export function getCostBasisAssetsVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - COST_BASIS_ASSETS_CHROME_LINES);
}

export function getCostBasisDisposalsVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - COST_BASIS_DISPOSALS_CHROME_LINES);
}
