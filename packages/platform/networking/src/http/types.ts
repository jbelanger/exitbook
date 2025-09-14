export interface HttpRequest {
  body?: BodyInit | object | undefined;
  endpoint: string;
  headers?: Record<string, string> | undefined;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | undefined;
  timeout?: number | undefined;
}

export interface HttpResponse<T = unknown> {
  data: T;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export interface HttpClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string> | undefined;
  providerId?: string | undefined;
  retries?: number | undefined;
  timeout?: number | undefined;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: string | undefined,
    public readonly retryAfter?: string | undefined,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class HttpTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeout: number,
  ) {
    super(message);
    this.name = 'HttpTimeoutError';
  }
}
