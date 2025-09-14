export interface RateLimitConfig {
  burstLimit?: number | undefined;
  requestsPerHour?: number | undefined;
  requestsPerMinute?: number | undefined;
  requestsPerSecond: number;
}

export interface RateLimitStatus {
  maxTokens: number;
  requestsPerSecond: number;
  tokens: number;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}
