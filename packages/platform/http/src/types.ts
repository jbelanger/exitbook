// HTTP-related error classes
export class ServiceError extends Error {
  constructor(
    message: string,
    public service: string,
    public operation: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class RateLimitError extends ServiceError {
  constructor(
    message: string,
    service: string,
    operation: string,
    public retryAfter?: number
  ) {
    super(message, service, operation);
    this.name = 'RateLimitError';
  }
}

export interface RateLimitConfig {
  burstLimit?: number | undefined;
  requestsPerHour?: number | undefined;
  requestsPerMinute?: number | undefined;
  requestsPerSecond: number;
}
