import { calculateChromeLines, calculateVisibleRows } from '../../../ui/shared/layout.js';

export const ASSET_DETAIL_LINES = 13;

const ASSETS_BASE_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1,
  header: 1,
  afterHeader: 1,
  listScrollIndicators: 2,
  divider: 1,
  detail: ASSET_DETAIL_LINES,
  beforeControls: 1,
  controls: 1,
  buffer: 1,
});

const ASSETS_FEEDBACK_LINES = 2;

function getAssetsChromeLines(hasFeedback: boolean): number {
  return ASSETS_BASE_CHROME_LINES + (hasFeedback ? ASSETS_FEEDBACK_LINES : 0);
}

export function getAssetsVisibleRows(terminalHeight: number, hasFeedback: boolean): number {
  return calculateVisibleRows(terminalHeight, getAssetsChromeLines(hasFeedback));
}
