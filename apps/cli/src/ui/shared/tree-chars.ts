/**
 * Tree characters for hierarchical displays
 *
 * Used to create visual tree structures in terminal output:
 * ├─ Branch (has siblings below)
 * └─ Last branch (no siblings below)
 */

export const TreeChars = {
  /** Branch character (has more items below) */
  BRANCH: '├─',

  /** Last branch character (final item in list) */
  LAST_BRANCH: '└─',

  /** Vertical line for continuation */
  VERTICAL: '│',

  /** Horizontal line for separators */
  HORIZONTAL: '─',
} as const;
