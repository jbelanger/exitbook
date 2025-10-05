/**
 * Exchange cursor for tracking progress per operation type.
 * Each operation type (trade, deposit, withdrawal, order) maintains its own timestamp.
 */
export type ExchangeCursor = Record<string, number>;

/**
 * Update cursor with a new timestamp for a specific operation type
 */
export function updateCursor(cursor: ExchangeCursor, operationType: string, timestampMs: number): ExchangeCursor {
  return {
    ...cursor,
    [operationType]: timestampMs,
  };
}

/**
 * Get the timestamp for a specific operation type
 */
export function getCursorTimestamp(
  cursor: ExchangeCursor | null | undefined,
  operationType: string
): number | undefined {
  return cursor?.[operationType];
}

/**
 * Create an empty cursor
 */
export function createEmptyCursor(): ExchangeCursor {
  return {};
}
