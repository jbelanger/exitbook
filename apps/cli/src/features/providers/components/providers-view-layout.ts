/**
 * Layout constants and helpers for providers TUI rows.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

const PROVIDERS_CHROME_LINES = 18;

export function getProvidersViewVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, PROVIDERS_CHROME_LINES);
}
