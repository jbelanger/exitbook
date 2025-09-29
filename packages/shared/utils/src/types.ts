// Generic error classes for both exchange and blockchain operations
export class ServiceError extends Error {
  constructor(
    message: string,
    public service: string, // exchange name or blockchain name
    public operation: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface RateLimitConfig {
  burstLimit?: number | undefined;
  requestsPerHour?: number | undefined;
  requestsPerMinute?: number | undefined;
  requestsPerSecond: number;
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

export class AuthenticationError extends ServiceError {
  constructor(message: string, service: string, operation: string) {
    super(message, service, operation);
    this.name = 'AuthenticationError';
  }
}
