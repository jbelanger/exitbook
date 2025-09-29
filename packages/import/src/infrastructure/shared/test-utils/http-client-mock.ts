import { vi } from 'vitest';

interface HttpClientMock {
  getModuleMocks(): {
    '@exitbook/shared-logger': {
      getLogger: ReturnType<typeof vi.fn>;
    };
    '@exitbook/shared-utils': {
      HttpClient: ReturnType<typeof vi.fn>;
      RateLimiterFactory: {
        getOrCreate: ReturnType<typeof vi.fn>;
      };
    };
  };
  injectIntoInstance(instance: object): void;
  mockHttpClient: {
    getRateLimitStatus: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
  };
  MockHttpClient: ReturnType<typeof vi.fn>;
  MockLogger: ReturnType<typeof vi.fn>;
  MockRateLimiterFactory: {
    getOrCreate: ReturnType<typeof vi.fn>;
  };
  resetAll(): void;
}

/**
 * Reusable HttpClient mock for testing
 *
 * Usage:
 * ```typescript
 * import { createHttpClientMock } from "../../shared/test-utils/http-client-mock";
 *
 * const mocks = createHttpClientMock();
 *
 * // In vi.mock:
 * vi.mock("@exitbook/shared-utils", () => ({
 *   HttpClient: mocks.MockHttpClient,
 *   RateLimiterFactory: mocks.MockRateLimiterFactory,
 * }));
 *
 * // In beforeEach:
 * mocks.injectIntoInstance(client);
 * ```
 */
export function createHttpClientMock(): HttpClientMock {
  const mockHttpClient = {
    getRateLimitStatus: vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    })),
    request: vi.fn(),
  };

  const MockHttpClient = vi.fn().mockImplementation(() => mockHttpClient);

  const MockRateLimiterFactory = {
    getOrCreate: vi.fn(() => ({
      waitForPermission: vi.fn().mockResolvedValue(void 0),
    })),
  };

  const MockLogger = vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }));

  return {
    /**
     * Get the complete mock setup for vi.mock calls
     */
    getModuleMocks() {
      return {
        '@exitbook/shared-logger': {
          getLogger: MockLogger,
        },
        '@exitbook/shared-utils': {
          HttpClient: MockHttpClient,
          RateLimiterFactory: MockRateLimiterFactory,
        },
      };
    },
    /**
     * Inject the mock HttpClient into a class instance that has a private httpClient property
     */
    injectIntoInstance(instance: object): void {
      Object.defineProperty(instance, 'httpClient', {
        configurable: true,
        value: mockHttpClient,
        writable: true,
      });
    },
    mockHttpClient,
    MockHttpClient,

    MockLogger,

    MockRateLimiterFactory,

    /**
     * Reset all mocks to their initial state
     */
    resetAll(): void {
      vi.clearAllMocks();
    },
  };
}

/**
 * Convenience function to create hoisted mocks for vi.mock
 *
 * Usage:
 * ```typescript
 * const mocks = vi.hoisted(() => createHttpClientMock());
 *
 * vi.mock("@exitbook/shared-utils", () => mocks.getModuleMocks()["@exitbook/shared-utils"]);
 * vi.mock("@exitbook/shared-logger", () => mocks.getModuleMocks()["@exitbook/shared-logger"]);
 * ```
 */
export function createHoistedHttpClientMock(): HttpClientMock {
  return createHttpClientMock();
}
