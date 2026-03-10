/**
 * Shared layout budgeting for links view dashboards.
 */

import { calculateChromeLines } from '../../../ui/shared/index.js';

export const GAP_TOP_ASSET_LIMIT = 5;

export const LINK_DETAIL_LINES = 8;
export const GAP_DETAIL_LINES = 7;

export const LINKS_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Links · N total"
  afterHeader: 1, // blank line
  divider: 1, // separator line
  detail: LINK_DETAIL_LINES, // link detail panel
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

export function getGapsChromeLines(assetCount: number): number {
  return calculateChromeLines({
    beforeHeader: 1, // blank line
    header: 2, // title + summary
    afterHeader: 1, // blank line
    summary: assetCount > 0 ? 1 : 0,
    afterSummary: 1, // blank line
    listScrollIndicators: 2, // "▲/▼ N more above/below"
    divider: 1, // separator line
    detail: GAP_DETAIL_LINES, // gap detail panel
    beforeControls: 1, // blank line
    controls: 1, // control hints
    buffer: 1, // bottom margin
  });
}
