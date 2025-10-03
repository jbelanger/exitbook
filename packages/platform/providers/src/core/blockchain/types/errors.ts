/**
 * Error type for normalization failures.
 * Discriminated union to distinguish between safe skips and actual errors.
 */
export type NormalizationError =
  | {
      reason: string;
      type: 'skip';
    }
  | {
      message: string;
      type: 'error';
    };

/**
 * Errors that can occur during provider operations
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_PROVIDERS' | 'ALL_PROVIDERS_FAILED' | 'PROVIDER_NOT_FOUND',
    public readonly details?: { blockchain?: string; lastError?: string; operation?: string; }
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
