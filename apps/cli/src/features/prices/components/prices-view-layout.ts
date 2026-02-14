/**
 * Layout constants for prices TUI rows.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

const COVERAGE_CHROME_LINES = 14;
const MISSING_CHROME_LINES = 18;

export function getPricesViewVisibleRows(terminalHeight: number, mode: 'coverage' | 'missing'): number {
  const chromeLines = mode === 'missing' ? MISSING_CHROME_LINES : COVERAGE_CHROME_LINES;
  return calculateVisibleRows(terminalHeight, chromeLines);
}
