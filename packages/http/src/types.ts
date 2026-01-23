import type { ZodType } from 'zod';

import type { InstrumentationCollector } from './instrumentation.js';

export interface HttpClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  providerName: string;
  rateLimit: RateLimitConfig;
  retries?: number | undefined;
  service?: 'blockchain' | 'exchange' | 'price' | undefined;
  timeout?: number | undefined;
}

export interface HttpRequestOptions {
  body?: string | Buffer | Uint8Array | object | undefined;
  headers?: Record<string, string> | undefined;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined;
  schema?: ZodType<unknown> | undefined;
  timeout?: number | undefined;
}

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

export class ResponseValidationError extends Error {
  constructor(
    message: string,
    public providerName: string,
    public endpoint: string,
    public validationIssues: { message: string; path: string }[],
    public truncatedPayload: string
  ) {
    super(message);
    this.name = 'ResponseValidationError';
  }
}

export interface RateLimitConfig {
  burstLimit?: number | undefined;
  requestsPerHour?: number | undefined;
  requestsPerMinute?: number | undefined;
  requestsPerSecond: number;
}
