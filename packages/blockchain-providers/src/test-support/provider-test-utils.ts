import type { Result } from '@exitbook/foundation';
import { expect, vi } from 'vitest';

import type { IBlockchainProvider } from '../contracts/index.js';

/**
 * Asserts that a Result is Ok and returns the unwrapped value.
 * Eliminates the repetitive `expect(result.isOk()).toBe(true); if (result.isOk()) { ... }` pattern.
 *
 * @example
 * const normalized = expectOk(mapBlockstreamTransaction(rawData, config));
 * expect(normalized.id).toBe('txid');
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw new Error('Expected Ok result');
  }
  return result.value;
}

/**
 * Asserts that a Result is Err and returns the unwrapped error.
 *
 * @example
 * const error = expectErr(mapBlockstreamTransaction(badData, config));
 * expect(error.message).toContain('validation');
 */
export function expectErr<T, E>(result: Result<T, E>): E {
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) {
    throw new Error('Expected Err result');
  }
  return result.error;
}

// ── Mock HTTP client for api-client unit tests ──────────────────────

export interface MockHttpClient {
  close: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getRateLimitStatus: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock HTTP client with all methods stubbed.
 * Use with `injectMockHttpClient` to wire it into a provider instance.
 *
 * Note: each test file must still declare `vi.mock('@exitbook/logger', ...)` and
 * `vi.mock('@exitbook/shared-utils', ...)` at module level since vitest hoists them.
 */
export function createMockHttpClient(): MockHttpClient {
  return {
    close: vi.fn(),
    get: vi.fn(),
    getRateLimitStatus: vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    })),
    post: vi.fn(),
    request: vi.fn(),
  };
}

/**
 * Resets all mocks on a MockHttpClient. Call in `beforeEach`.
 */
export function resetMockHttpClient(mock: MockHttpClient): void {
  mock.close = vi.fn();
  mock.get = vi.fn();
  mock.post = vi.fn();
  mock.request = vi.fn();
  mock.getRateLimitStatus = vi.fn(() => ({
    remainingRequests: 10,
    resetTime: Date.now() + 60000,
  }));
}

/**
 * Injects a mock HTTP client into a provider instance by overriding the
 * protected `httpClient` property.
 */
export function injectMockHttpClient(client: IBlockchainProvider, mock: MockHttpClient): void {
  Object.defineProperty(client, 'httpClient', {
    configurable: true,
    value: mock,
    writable: true,
  });
}
