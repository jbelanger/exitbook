/**
 * Errors that can occur during price provider operations
 */

/**
 * Error thrown when a coin/asset is not found in the provider's database
 * This is a recoverable error that can be handled interactively
 */
export class CoinNotFoundError extends Error {
  constructor(
    message: string,
    public readonly asset: string,
    public readonly provider: string,
    public readonly details?: {
      currency?: string;
      suggestion?: string;
      timestamp?: Date;
    }
  ) {
    super(message);
    this.name = 'CoinNotFoundError';
  }
}
