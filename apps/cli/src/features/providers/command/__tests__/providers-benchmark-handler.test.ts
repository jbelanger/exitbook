/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import {
  loadBlockchainExplorerConfig,
  openProviderBenchmarkSession,
  type ProviderBenchmarkSession,
} from '@exitbook/blockchain-providers';
import { err, ok } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { benchmarkRateLimit } from '../benchmark-tool.js';
import { ProviderBenchmarkHandler } from '../providers-benchmark-handler.js';

vi.mock('@exitbook/blockchain-providers', async () => {
  const actual = await vi.importActual('@exitbook/blockchain-providers');
  return {
    ...actual,
    loadBlockchainExplorerConfig: vi.fn(),
    openProviderBenchmarkSession: vi.fn(),
  };
});

vi.mock('../benchmark-tool.js', () => ({
  benchmarkRateLimit: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
  })),
}));

function createMockBenchmarkableProvider(overrides: { blockchain?: string; name: string; rateLimit: unknown }) {
  return {
    name: overrides.name,
    rateLimit: overrides.rateLimit,
    blockchain: overrides.blockchain ?? 'bitcoin',
    createUnboundedHealthCheck: vi.fn().mockReturnValue({
      checkHealth: vi.fn().mockResolvedValue(ok(true)),
      destroy: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function createMockBenchmarkSession(
  provider = createMockBenchmarkableProvider({
    name: 'blockstream.info',
    rateLimit: { requestsPerSecond: 5, burstLimit: 10 },
  })
): ProviderBenchmarkSession {
  return {
    provider,
    providerInfo: {
      name: provider.name,
      blockchain: provider.blockchain,
      rateLimit: provider.rateLimit,
    },
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ProviderBenchmarkHandler', () => {
  let handler: ProviderBenchmarkHandler;
  let mockLoadBlockchainExplorerConfig: ReturnType<typeof vi.fn>;
  let mockOpenProviderBenchmarkSession: ReturnType<typeof vi.fn>;
  let mockBenchmarkSession: ProviderBenchmarkSession;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadBlockchainExplorerConfig = vi.mocked(loadBlockchainExplorerConfig);
    mockOpenProviderBenchmarkSession = vi.mocked(openProviderBenchmarkSession);
    mockBenchmarkSession = createMockBenchmarkSession();
    mockLoadBlockchainExplorerConfig.mockReturnValue(ok(undefined));
    handler = new ProviderBenchmarkHandler();
  });

  afterEach(async () => {
    await handler.destroy();
  });

  it('executes a benchmark for a prepared provider session', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(ok(mockBenchmarkSession));
    vi.mocked(benchmarkRateLimit).mockResolvedValue({
      testResults: [{ rate: 1, success: true, responseTimeMs: 200 }],
      burstLimits: [{ limit: 5, success: true }],
      maxSafeRate: 2,
      recommended: {
        requestsPerSecond: 1.6,
        burstLimit: 4,
      },
    });

    const result = await handler.execute({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
      maxRate: '5',
      numRequests: '10',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.params.blockchain).toBe('bitcoin');
      expect(result.value.params.provider).toBe('blockstream.info');
      expect(result.value.params.maxRate).toBe(5);
      expect(result.value.params.numRequests).toBe(10);
      expect(result.value.provider.name).toBe('blockstream.info');
      expect(result.value.result.maxSafeRate).toBe(2);
    }

    expect(mockOpenProviderBenchmarkSession).toHaveBeenCalledWith({
      blockchain: 'bitcoin',
      explorerConfig: undefined,
      providerName: 'blockstream.info',
    });
    expect(benchmarkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRequestsPerSecond: 5,
        numRequestsPerTest: 10,
        testBurstLimits: true,
      })
    );
  });

  it('passes custom rates through to benchmarkRateLimit', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(ok(mockBenchmarkSession));
    vi.mocked(benchmarkRateLimit).mockResolvedValue({
      testResults: [{ rate: 1, success: true }],
      maxSafeRate: 1,
      recommended: { requestsPerSecond: 0.8 },
    });

    const result = await handler.execute({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
      rates: '0.5,1,2',
    });

    expect(result.isOk()).toBe(true);
    expect(benchmarkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        customRates: [0.5, 1, 2],
      })
    );
  });

  it('skips burst tests when requested', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(ok(mockBenchmarkSession));
    vi.mocked(benchmarkRateLimit).mockResolvedValue({
      testResults: [{ rate: 1, success: true }],
      maxSafeRate: 1,
      recommended: { requestsPerSecond: 0.8 },
    });

    const result = await handler.execute({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
      skipBurst: true,
    });

    expect(result.isOk()).toBe(true);
    expect(benchmarkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        testBurstLimits: false,
      })
    );
  });

  it('returns provider-session errors unchanged', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(
      err(
        new Error(
          "Provider 'invalid-provider' not found for blockchain 'bitcoin'. Available providers: blockstream.info"
        )
      )
    );

    const result = await handler.execute({
      blockchain: 'bitcoin',
      provider: 'invalid-provider',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Provider 'invalid-provider' not found");
    }
  });

  it('returns explorer config load errors before opening a session', async () => {
    mockLoadBlockchainExplorerConfig.mockReturnValue(err(new Error('Invalid blockchain explorer config')));

    const result = await handler.execute({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid blockchain explorer config');
    }
    expect(mockOpenProviderBenchmarkSession).not.toHaveBeenCalled();
  });

  it('returns validation errors before opening a session', async () => {
    const result = await handler.execute({
      blockchain: '',
      provider: 'blockstream.info',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Blockchain is required');
    }
    expect(mockOpenProviderBenchmarkSession).not.toHaveBeenCalled();
  });

  it('returns benchmark errors unchanged', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(ok(mockBenchmarkSession));
    vi.mocked(benchmarkRateLimit).mockRejectedValue(new Error('Network timeout during benchmark'));

    const result = await handler.execute({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Network timeout during benchmark');
    }
  });

  it('prepareSession exposes provider metadata for TUI setup', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(ok(mockBenchmarkSession));

    const result = await handler.prepareSession({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.providerInfo).toEqual({
        blockchain: 'bitcoin',
        name: 'blockstream.info',
        rateLimit: { requestsPerSecond: 5, burstLimit: 10 },
      });
      expect(result.value.session).toBe(mockBenchmarkSession);
    }
  });

  it('destroy cleans up the open benchmark session', async () => {
    mockOpenProviderBenchmarkSession.mockResolvedValue(ok(mockBenchmarkSession));
    await handler.prepareSession({
      blockchain: 'bitcoin',
      provider: 'blockstream.info',
    });

    await handler.destroy();

    expect(mockBenchmarkSession.cleanup).toHaveBeenCalled();
  });

  it('destroy is idempotent', async () => {
    await handler.destroy();
    await expect(handler.destroy()).resolves.not.toThrow();
  });
});
