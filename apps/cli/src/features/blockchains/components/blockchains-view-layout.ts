/**
 * Layout constants and helpers for blockchains TUI rows.
 */

const BLOCKCHAINS_CHROME_LINES = 16;

export function getBlockchainsViewVisibleRows(terminalHeight: number): number {
  return Math.max(1, terminalHeight - BLOCKCHAINS_CHROME_LINES);
}
