/**
 * Layout constants for prices TUI rows.
 */

const COVERAGE_CHROME_LINES = 14;
const MISSING_CHROME_LINES = 18;

export function getPricesViewVisibleRows(terminalHeight: number, mode: 'coverage' | 'missing'): number {
  const chromeLines = mode === 'missing' ? MISSING_CHROME_LINES : COVERAGE_CHROME_LINES;
  return Math.max(1, terminalHeight - chromeLines);
}
