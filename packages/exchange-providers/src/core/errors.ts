import type { ExternalTransaction } from '@exitbook/core';

/**
 * Error thrown when validation fails partway through fetching data.
 * Contains all successfully validated items up to the point of failure.
 */
export class PartialImportError extends Error {
  constructor(
    message: string,
    public readonly successfulItems: ExternalTransaction[],
    public readonly failedItem: unknown,
    public readonly lastSuccessfulCursor?: Record<string, number>
  ) {
    super(message);
    this.name = 'PartialImportError';
  }
}
