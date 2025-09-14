import { Context, Effect, Layer, Ref } from 'effect';

import type { HttpClient } from '../http/client.js';
import type { HttpRequest, HttpResponse, HttpError, HttpTimeoutError } from '../http/types.js';
import {
  HttpError as HttpErrorClass,
  HttpTimeoutError as HttpTimeoutErrorClass,
} from '../http/types.js';
import { RateLimiterTag } from '../limiter/rate-limiter.js';
import { CircuitBreakerTag } from '../resilience/circuit-breaker.js';

export interface MockHttpResponse<T = unknown> {
  data: T;
  headers?: Record<string, string>;
  status?: number;
  statusText?: string;
}

export interface TestHttpClient extends HttpClient {
  readonly addMockResponse: (
    predicate: (req: HttpRequest) => boolean,
    response: MockHttpResponse | Error,
  ) => Effect.Effect<void, never, never>;
  readonly clearMockResponses: () => Effect.Effect<void, never, never>;
  readonly getRequestHistory: () => Effect.Effect<HttpRequest[], never, never>;
}

export const TestHttpClientTag = Context.GenericTag<TestHttpClient>(
  '@exitbook/platform-networking/TestHttpClient',
);

export const TestHttpClientLive = () =>
  Layer.effect(
    TestHttpClientTag,
    Effect.gen(function* () {
      const requestHistory = yield* Ref.make<HttpRequest[]>([]);
      const mockResponses = yield* Ref.make<
        { predicate: (req: HttpRequest) => boolean; response: MockHttpResponse | Error }[]
      >([]);

      const simulateRequest = <T = unknown>(
        req: HttpRequest,
      ): Effect.Effect<HttpResponse<T>, HttpError | HttpTimeoutError> =>
        Effect.gen(function* () {
          yield* Ref.update(requestHistory, (history) => [...history, req]);

          const mocks = yield* Ref.get(mockResponses);
          const matchingMock = mocks.find((mock) => mock.predicate(req));

          if (matchingMock) {
            if (matchingMock.response instanceof Error) {
              // Convert generic Error to proper HTTP errors
              if (
                matchingMock.response instanceof HttpErrorClass ||
                matchingMock.response instanceof HttpTimeoutErrorClass
              ) {
                return yield* Effect.fail(matchingMock.response);
              }
              // Default to HTTP error for unknown errors
              return yield* Effect.fail(new HttpErrorClass(matchingMock.response.message, 500));
            }

            return {
              data: matchingMock.response.data as T,
              headers: matchingMock.response.headers ?? {},
              status: matchingMock.response.status ?? 200,
              statusText: matchingMock.response.statusText ?? 'OK',
            };
          }

          // Default successful response
          return {
            data: {} as T,
            headers: {},
            status: 200,
            statusText: 'OK',
          };
        });

      return {
        addMockResponse: (predicate, response) =>
          Ref.update(mockResponses, (mocks) => [...mocks, { predicate, response }]),

        clearMockResponses: () => Ref.set(mockResponses, []),

        get: <T = unknown>(endpoint: string, options?: Omit<HttpRequest, 'method' | 'endpoint'>) =>
          Effect.gen(function* () {
            const result = yield* simulateRequest<T>({ ...options, endpoint, method: 'GET' });
            return result.data;
          }),

        getConfig: () =>
          Effect.succeed({
            baseUrl: 'http://test.example.com',
            providerId: 'test',
          }),

        getRequestHistory: () => Ref.get(requestHistory),

        head: <T = unknown>(endpoint: string, options?: Omit<HttpRequest, 'method' | 'endpoint'>) =>
          Effect.gen(function* () {
            const result = yield* simulateRequest<T>({ ...options, endpoint, method: 'HEAD' });
            return result.data;
          }),

        patch: <T = unknown>(
          endpoint: string,
          body?: unknown,
          options?: Omit<HttpRequest, 'method' | 'body' | 'endpoint'>,
        ) =>
          Effect.gen(function* () {
            const result = yield* simulateRequest<T>({
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
            const result = yield* simulateRequest<T>({
              ...options,
              body: body as BodyInit | object | undefined,
              endpoint,
              method: 'POST',
            });
            return result.data;
          }),

        request: <T = unknown>(req: HttpRequest) =>
          Effect.gen(function* () {
            const result = yield* simulateRequest<T>(req);
            return result.data;
          }),

        requestRaw: simulateRequest,
      };
    }),
  );

export const InMemoryRateLimiterLive = () =>
  Layer.effect(
    RateLimiterTag,
    Effect.gen(function* () {
      const state = yield* Ref.make(new Map<string, { lastRefill: number; tokens: number }>());

      return {
        canMakeRequest: () => Effect.succeed(true),
        getStatus: (_key: string) =>
          Effect.succeed({
            maxTokens: 100,
            requestsPerSecond: 10,
            tokens: 50,
          }),
        reset: () => Ref.set(state, new Map()),
        waitToken: () => Effect.void,
      };
    }),
  );

export const InMemoryCircuitBreakerLive = () =>
  Layer.effect(
    CircuitBreakerTag,
    Effect.gen(function* () {
      const state = yield* Ref.make(new Map<string, 'open' | 'closed' | 'half-open'>());

      return {
        execute: <A, E>(key: string, effect: Effect.Effect<A, E>) => effect,
        getState: () => Effect.succeed('closed' as const),
        getStats: () =>
          Effect.succeed({
            failureCount: 0,
            lastFailureTimestamp: 0,
            lastSuccessTimestamp: Date.now(),
            maxFailures: 5,
            state: 'closed' as const,
            timeSinceLastFailureMs: 0,
            timeUntilRecoveryMs: 0,
          }),
        recordFailure: () => Effect.void,
        recordSuccess: () => Effect.void,
        reset: () => Ref.set(state, new Map()),
      };
    }),
  );

export const NetworkingTestkit = {
  InMemoryCircuitBreakerLive,
  InMemoryRateLimiterLive,
  TestHttpClientLive,
} as const;
