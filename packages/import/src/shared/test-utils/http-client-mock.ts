import { vi } from "vitest";

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
 * vi.mock("@crypto/shared-utils", () => ({
 *   HttpClient: mocks.MockHttpClient,
 *   RateLimiterFactory: mocks.MockRateLimiterFactory,
 * }));
 *
 * // In beforeEach:
 * mocks.injectIntoInstance(client);
 * ```
 */
export function createHttpClientMock() {
  const mockHttpClient = {
    request: vi.fn(),
    getRateLimitStatus: vi.fn(() => ({
      remainingRequests: 10,
      resetTime: Date.now() + 60000,
    })),
  };

  const MockHttpClient = vi.fn().mockImplementation(() => mockHttpClient);

  const MockRateLimiterFactory = {
    getOrCreate: vi.fn(() => ({
      waitForPermission: vi.fn().mockResolvedValue(void 0),
    })),
  };

  const MockLogger = vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));

  return {
    mockHttpClient,
    MockHttpClient,
    MockRateLimiterFactory,
    MockLogger,

    /**
     * Inject the mock HttpClient into a class instance that has a private httpClient property
     */
    injectIntoInstance(instance: object): void {
      Object.defineProperty(instance, "httpClient", {
        value: mockHttpClient,
        writable: true,
        configurable: true,
      });
    },

    /**
     * Reset all mocks to their initial state
     */
    resetAll(): void {
      vi.clearAllMocks();
    },

    /**
     * Get the complete mock setup for vi.mock calls
     */
    getModuleMocks() {
      return {
        "@crypto/shared-utils": {
          HttpClient: MockHttpClient,
          RateLimiterFactory: MockRateLimiterFactory,
        },
        "@crypto/shared-logger": {
          getLogger: MockLogger,
        },
      };
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
 * vi.mock("@crypto/shared-utils", () => mocks.getModuleMocks()["@crypto/shared-utils"]);
 * vi.mock("@crypto/shared-logger", () => mocks.getModuleMocks()["@crypto/shared-logger"]);
 * ```
 */
export function createHoistedHttpClientMock() {
  return createHttpClientMock();
}
