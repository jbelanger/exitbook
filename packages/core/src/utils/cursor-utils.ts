import type { CursorState } from '../schemas/cursor.js';

/**
 * Type guard to check if a cursor is a CursorState (blockchain provider format)
 */
export function isCursorState(cursor: unknown): cursor is CursorState {
  return (
    typeof cursor === 'object' &&
    cursor !== null &&
    'primary' in cursor &&
    'lastTransactionId' in cursor &&
    'totalFetched' in cursor
  );
}

/**
 * Type guard to check if a cursor is an exchange cursor (Record format)
 */
export function isExchangeCursor(cursor: unknown): cursor is Record<string, unknown> {
  return typeof cursor === 'object' && cursor !== null && !isCursorState(cursor);
}
