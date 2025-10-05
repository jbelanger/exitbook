import type { RawTransactionWithMetadata } from './types.ts';

/**
 * Error thrown when validation fails partway through fetching data.
 * Contains all successfully validated items up to the point of failure.
 */
export class PartialImportError extends Error {
  constructor(
    message: string,
    public readonly successfulItems: RawTransactionWithMetadata[],
    public readonly failedItem: unknown,
    public readonly lastSuccessfulTimestamp?: Date
  ) {
    super(message);
    this.name = 'PartialValidationError';
  }
}
