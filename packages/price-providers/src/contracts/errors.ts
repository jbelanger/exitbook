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
    public readonly assetSymbol: string,
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

/**
 * Error thrown when price data is unavailable due to provider limitations
 * (e.g., date out of range, rate limits, tier restrictions)
 * This is a recoverable error that can be handled interactively
 */
export class PriceDataUnavailableError extends Error {
  constructor(
    message: string,
    public readonly assetSymbol: string,
    public readonly provider: string,
    public readonly reason: 'date-out-of-range' | 'rate-limit' | 'tier-limitation' | 'other',
    public readonly details?: {
      currency?: string;
      suggestion?: string;
      timestamp?: Date;
    }
  ) {
    super(message);
    this.name = 'PriceDataUnavailableError';
  }
}
