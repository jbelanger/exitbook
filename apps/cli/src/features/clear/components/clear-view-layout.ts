/**
 * Clear view layout calculations
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';

/**
 * Calculate visible rows for category list.
 * Layout breakdown (total: 14 rows of chrome):
 * - 1 blank line (top)
 * - 1 header line
 * - 1 blank line
 * - N category rows (variable)
 * - 1 divider
 * - 4 detail panel lines (minimum)
 * - 1 blank line
 * - 1 controls bar
 * - 4 buffer lines (bottom)
 *
 * visible rows = terminal height - 14
 */
export function getClearViewVisibleRows(terminalHeight: number): number {
  const chromeHeight = 14;
  return calculateVisibleRows(terminalHeight, chromeHeight);
}
