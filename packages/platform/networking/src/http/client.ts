import { Context, Effect, Layer } from 'effect';

import { recordHttpRequest, recordHttpError } from '../metrics/index.js';

import type {
  HttpRequest,
  HttpResponse,
  HttpClientConfig,
  HttpError,
  HttpTimeoutError,
} from './types.js';
import { HttpError as HttpErrorClass, HttpTimeoutError as HttpTimeoutErrorClass } from './types.js';

export interface HttpClient {
  readonly get: <T = unknown>(
    endpoint: string,
    options?: Omit<HttpRequest, 'method' | 'endpoint'>,
  ) => Effect.Effect<T, HttpError | HttpTimeoutError, never>;
  readonly getConfig: () => Effect.Effect<HttpClientConfig, never, never>;
  readonly head: <T = unknown>(
    endpoint: string,
    options?: Omit<HttpRequest, 'method' | 'endpoint'>,
  ) => Effect.Effect<T, HttpError | HttpTimeoutError, never>;
  readonly patch: <T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<HttpRequest, 'method' | 'body' | 'endpoint'>,
  ) => Effect.Effect<T, HttpError | HttpTimeoutError, never>;
  readonly post: <T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<HttpRequest, 'method' | 'body' | 'endpoint'>,
  ) => Effect.Effect<T, HttpError | HttpTimeoutError, never>;
  readonly request: <T = unknown>(
    req: HttpRequest,
  ) => Effect.Effect<T, HttpError | HttpTimeoutError, never>;
  readonly requestRaw: <T = unknown>(
    req: HttpRequest,
  ) => Effect.Effect<HttpResponse<T>, HttpError | HttpTimeoutError, never>;
}

export const HttpClientTag = Context.GenericTag<HttpClient>(
  '@exitbook/platform-networking/HttpClient',
);

export const HttpClientLive = (config: HttpClientConfig) => {
  const sanitizeUrl = (url: string): string => {
    // Remove query parameters and only keep the path for metrics
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch {
      return url;
    }
  };

  const parseRetryAfter = (retryAfter: string | null): number => {
    if (!retryAfter) return 0;

    // Try parsing as seconds (integer)
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000; // convert to milliseconds
    }

    // Try parsing as HTTP date
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }

    return 0;
  };

  const shouldRetry = (e: unknown): boolean => {
    if (e instanceof HttpTimeoutErrorClass) return true;
    if (e instanceof HttpErrorClass) {
      if (e.status === 429) return true;
      if (e.status >= 500) return true;
    }
    return false;
  };

  const requestRaw = <T = unknown>(req: HttpRequest) =>
    Effect.gen(function* () {
      const url = buildUrl(config.baseUrl, req.endpoint);
      const method = req.method ?? 'GET';
      const timeout = req.timeout ?? config.timeout ?? 10_000;
      const started = Date.now();

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'exitbook-platform/1.0.0',
        ...config.defaultHeaders,
        ...req.headers,
      };

      const body = req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
      if (body && typeof req.body === 'object') {
        headers['Content-Type'] = 'application/json';
      }

      const doFetch = Effect.tryPromise({
        catch: (e) => {
          if (e instanceof Error && e.name === 'AbortError') {
            return new HttpTimeoutErrorClass(`Request timeout after ${timeout}ms`, timeout);
          }
          return new HttpErrorClass(`Network error: ${String(e)}`, 0);
        },
        try: async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          try {
            const resp = await fetch(url, {
              body: body ?? undefined,
              headers,
              method,
              signal: controller.signal,
            });

            if (!resp.ok) {
              const text = await resp.text().catch(() => '');
              const retryAfter = resp.headers.get('Retry-After') || undefined;
              throw new HttpErrorClass(
                `HTTP ${resp.status}: ${text}`,
                resp.status,
                text,
                retryAfter,
              );
            }

            const responseHeaders: Record<string, string> = {};
            resp.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });

            const ct = resp.headers.get('content-type') ?? '';
            const data = ct.includes('application/json')
              ? ((await resp.json()) as T)
              : ((await resp.text()) as unknown as T);

            return {
              data,
              headers: responseHeaders,
              status: resp.status,
              statusText: resp.statusText,
            };
          } finally {
            clearTimeout(timeoutId);
          }
        },
      });

      // Custom retry logic with predicate and Retry-After handling
      const retryWithPredicate = Effect.gen(function* () {
        let attempt = 0;
        const maxAttempts = (config.retries ?? 2) + 1;

        while (attempt < maxAttempts) {
          const result = yield* Effect.either(doFetch);

          if (result._tag === 'Right') {
            return result.right;
          }

          attempt++;

          if (attempt >= maxAttempts || !shouldRetry(result.left)) {
            return yield* Effect.fail(result.left);
          }

          // Calculate delay with exponential backoff + jitter
          let delayMs = 200 * Math.pow(2, attempt - 1) + Math.random() * 100;

          // Honor Retry-After header if present
          if (result.left instanceof HttpErrorClass && result.left.retryAfter) {
            const retryAfterMs = parseRetryAfter(result.left.retryAfter);
            if (retryAfterMs > 0) {
              delayMs = retryAfterMs;
            }
          }

          yield* Effect.sleep(delayMs);
        }

        // This should never be reached, but TypeScript needs it
        return yield* Effect.die('Retry logic failed unexpectedly');
      });

      const result = yield* retryWithPredicate;

      const duration = Date.now() - started;
      yield* Effect.all(
        recordHttpRequest(method, sanitizeUrl(url), result.status, duration, config.providerId),
      );
      return result;
    }).pipe(
      Effect.tapError((err: unknown) =>
        recordHttpError(
          req.method ?? 'GET',
          err instanceof Error ? err.name : String(err),
          config.providerId,
          buildUrl(config.baseUrl, req.endpoint),
        ),
      ),
    );

  return Layer.succeed(HttpClientTag, {
    get: <T = unknown>(endpoint: string, options?: Omit<HttpRequest, 'method' | 'endpoint'>) =>
      Effect.gen(function* () {
        const result = yield* requestRaw<T>({ ...options, endpoint, method: 'GET' });
        return result.data;
      }),

    getConfig: () => Effect.succeed(config),

    head: <T = unknown>(endpoint: string, options?: Omit<HttpRequest, 'method' | 'endpoint'>) =>
      Effect.gen(function* () {
        const result = yield* requestRaw<T>({ ...options, endpoint, method: 'HEAD' });
        return result.data;
      }),

    patch: <T = unknown>(
      endpoint: string,
      body?: unknown,
      options?: Omit<HttpRequest, 'method' | 'body' | 'endpoint'>,
    ) =>
      Effect.gen(function* () {
        const result = yield* requestRaw<T>({
          ...options,
          body: body as BodyInit | object | undefined,
          endpoint,
          method: 'PATCH',
        });
        return result.data;
      }),

    post: <T = unknown>(
      endpoint: string,
      body?: unknown,
      options?: Omit<HttpRequest, 'method' | 'body' | 'endpoint'>,
    ) =>
      Effect.gen(function* () {
        const result = yield* requestRaw<T>({
          ...options,
          body: body as BodyInit | object | undefined,
          endpoint,
          method: 'POST',
        });
        return result.data;
      }),

    request: <T = unknown>(req: HttpRequest) =>
      Effect.gen(function* () {
        const result = yield* requestRaw<T>(req);
        return result.data;
      }),

    requestRaw,
  });
};

function buildUrl(baseUrl: string, endpoint: string): string {
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  if (!endpoint || endpoint === '' || endpoint === '/') {
    return cleanBaseUrl;
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBaseUrl}${cleanEndpoint}`;
}
