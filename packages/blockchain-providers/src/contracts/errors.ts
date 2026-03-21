/**
 * Error type for normalization failures.
 * Discriminated union to distinguish between safe skips and actual errors.
 */
export interface NormalizationSkip {
  reason: string;
  type: 'skip';
}

export interface NormalizationErrorFault {
  message: string;
  type: 'error';
}

// skip = recoverable mismatch; error = data corruption
export type NormalizationError = NormalizationSkip | NormalizationErrorFault;

/**
 * Errors that can occur during provider operations
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_PROVIDERS' | 'ALL_PROVIDERS_FAILED' | 'PROVIDER_NOT_FOUND' | 'NO_COMPATIBLE_PROVIDERS',
    public readonly details?:
      | { blockchain?: string | undefined; lastError?: string | undefined; operation?: string | undefined }
      | undefined
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
