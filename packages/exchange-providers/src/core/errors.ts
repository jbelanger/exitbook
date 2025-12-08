import type { CursorState, RawTransactionInput } from '@exitbook/core';

/**
 * Error thrown when validation fails partway through fetching data.
 * Contains all successfully validated items up to the point of failure.
 *
 * @deprecated INTERNAL USE ONLY - Used by Coinbase client's processItems() call.
 * This pattern (error-as-data-carrier) is being phased out in favor of inline validation loops.
 * See packages/exchange-providers/src/exchanges/kraken/client.ts for the preferred pattern.
 *
 * Do not use in new code. When Coinbase is refactored to inline the loop, this class
 * can be removed entirely.
 */
export class PartialImportError extends Error {
  constructor(
    message: string,
    public readonly successfulItems: RawTransactionInput[],
    public readonly failedItem: unknown,
    public readonly lastSuccessfulCursorUpdates?: Record<string, CursorState>
  ) {
    super(message);
    this.name = 'PartialImportError';
  }
}
