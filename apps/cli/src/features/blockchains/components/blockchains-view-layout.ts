/**
 * Layout constants and helpers for blockchains TUI rows.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

const BLOCKCHAINS_CHROME_LINES = 16;

export function getBlockchainsViewVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, BLOCKCHAINS_CHROME_LINES);
}
