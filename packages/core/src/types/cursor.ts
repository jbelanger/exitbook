import type { z } from 'zod';

import type { CursorStateSchema, PaginationCursorSchema } from '../schemas/cursor.js';

/**
 * Cursor type classification for cross-provider compatibility
 */
export type CursorType = 'blockNumber' | 'timestamp' | 'txHash' | 'pageToken';

/**
 * Typed pagination cursor - inferred from Zod schema
 */
export type PaginationCursor = z.infer<typeof PaginationCursorSchema>;

/**
 * Complete cursor state for a pagination point - inferred from Zod schema
 */
export type CursorState = z.infer<typeof CursorStateSchema>;

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
