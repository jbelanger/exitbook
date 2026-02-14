/**
 * Shared layout constants/helpers for links TUI rows.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

const LINKS_CHROME_LINES = 14;
const GAPS_CHROME_LINES = 18;

export function getLinksViewVisibleRows(terminalHeight: number, mode: 'links' | 'gaps'): number {
  const chromeLines = mode === 'gaps' ? GAPS_CHROME_LINES : LINKS_CHROME_LINES;
  return calculateVisibleRows(terminalHeight, chromeLines);
}
