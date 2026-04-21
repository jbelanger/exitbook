import type { DataSession } from '@exitbook/data/session';
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBalanceWorkflowConstructor, mockBuildBalanceWorkflowPorts, mockCreateCliAssetReviewProjectionRuntime } =
  vi.hoisted(() => ({
    mockBalanceWorkflowConstructor: vi.fn(),
    mockBuildBalanceWorkflowPorts: vi.fn(),
    mockCreateCliAssetReviewProjectionRuntime: vi.fn(),
  }));

vi.mock('../../features/assets/command/asset-review-projection-runtime.js', () => ({
  createCliAssetReviewProjectionRuntime: mockCreateCliAssetReviewProjectionRuntime,
}));

vi.mock('../../features/balances/shared/build-balance-workflow-ports.js', () => ({
  buildBalanceWorkflowPorts: mockBuildBalanceWorkflowPorts,
}));

vi.mock('@exitbook/ingestion/balance', () => ({
  BalanceWorkflow: class {
    constructor(...args: unknown[]) {
      mockBalanceWorkflowConstructor(...args);
    }
  },
}));

import { createCliCommandResourceFactories } from '../command-capability-factories.js';

describe('createCliCommandResourceFactories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildBalanceWorkflowPorts.mockReturnValue({ tag: 'balance-ports' });
    mockCreateCliAssetReviewProjectionRuntime.mockReturnValue(ok({ ensureFresh: vi.fn(), rebuild: vi.fn() }));
  });

  it('creates asset review runtimes with CLI-owned config and scope', () => {
    const database = { tag: 'db' } as unknown as DataSession;
    const runtime = {
      dataDir: '/tmp/exitbook',
      requireAppRuntime: vi.fn().mockReturnValue({
        priceProviderConfig: {
          coingecko: {
            apiKey: 'cg-key',
            useProApi: true,
          },
        },
      }),
    };

    const factories = createCliCommandResourceFactories(runtime as never, database);
    assertOk(
      factories.assetReviewProjectionFactory.createForProfile({
        profileId: 7,
        profileKey: 'default',
      })
    );

    expect(mockCreateCliAssetReviewProjectionRuntime).toHaveBeenCalledWith(database, '/tmp/exitbook', {
      priceProviderConfig: {
        coingecko: {
          apiKey: 'cg-key',
          useProApi: true,
        },
      },
      profile: {
        profileId: 7,
        profileKey: 'default',
      },
    });
  });

  it('caches the balance workflow and registers provider cleanup once', async () => {
    const database = { tag: 'db' } as unknown as DataSession;
    const providerRuntime = {
      cleanup: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const runtime = {
      createManagedBlockchainProviderRuntime: vi.fn().mockResolvedValue(providerRuntime),
      dataDir: '/tmp/exitbook',
      onCleanup: vi.fn(),
      requireAppRuntime: vi.fn(),
    };

    const factories = createCliCommandResourceFactories(runtime as never, database);
    await factories.balanceWorkflowFactory.getOrCreate();
    await factories.balanceWorkflowFactory.getOrCreate();

    expect(runtime.createManagedBlockchainProviderRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.createManagedBlockchainProviderRuntime).toHaveBeenCalledWith({ registerCleanup: false });
    expect(runtime.onCleanup).toHaveBeenCalledTimes(1);
    expect(mockBuildBalanceWorkflowPorts).toHaveBeenCalledWith(database);
    expect(mockBalanceWorkflowConstructor).toHaveBeenCalledTimes(1);
    expect(mockBalanceWorkflowConstructor).toHaveBeenCalledWith({ tag: 'balance-ports' }, providerRuntime);
  });
});
