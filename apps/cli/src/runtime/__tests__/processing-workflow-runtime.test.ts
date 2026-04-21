/* eslint-disable @typescript-eslint/no-unsafe-return -- acceptable for tests */
import { ok, type Result } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAssetReviewProjectionFactory } from '../command-capability-factories.js';

const { mockBuildProcessingPorts, mockProcessingWorkflow, mockRebuild } = vi.hoisted(() => ({
  mockBuildProcessingPorts: vi.fn(),
  mockProcessingWorkflow: vi.fn(),
  mockRebuild: vi.fn(),
}));

vi.mock('@exitbook/data/ingestion', () => ({
  buildProcessingPorts: mockBuildProcessingPorts,
}));

vi.mock('@exitbook/ingestion/process', () => ({
  ProcessingWorkflow: class {
    constructor(...args: unknown[]) {
      mockProcessingWorkflow(...args);
    }
  },
}));

vi.mock('@exitbook/protocol-catalog', () => ({
  createSeedProtocolCatalog: vi.fn(() => ({ findByAddress: vi.fn() })),
}));

vi.mock('@exitbook/transaction-interpretation', () => ({
  AssetMigrationParticipantDetector: class {},
  BridgeParticipantDetector: class {},
  HeuristicBridgeParticipantDetector: class {},
  InterpretationRuntime: class {},
  StakingRewardDetector: class {},
  TransactionAnnotationDetectorRegistry: class {
    register() {
      /* no-op */
    }
  },
  TransactionAnnotationProfileDetectorRegistry: class {
    register() {
      /* no-op */
    }
  },
}));

import {
  createCliProcessingWorkflowRuntime,
  rebuildCliAssetReviewProjectionsForAccounts,
} from '../../features/import/command/import-processing-workflow-runtime.js';

describe('rebuildCliAssetReviewProjectionsForAccounts', () => {
  const createForProfile = vi.fn();
  const assetReviewProjectionFactory: CliAssetReviewProjectionFactory = {
    createForProfile: (profile) => createForProfile(profile),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildProcessingPorts.mockReturnValue({
      nearBatchSource: undefined,
    });
    mockRebuild.mockResolvedValue(ok(undefined));
    createForProfile.mockImplementation((_profile) =>
      ok({
        rebuild: mockRebuild,
      })
    );
  });

  it('builds the processing registry through the CLI-owned adapter factory', () => {
    const nearBatchSource = { fetch: vi.fn() };
    const ports = { nearBatchSource };
    const adapterRegistry = { getAllBlockchains: vi.fn() };
    const adapterRegistryFactory = vi.fn().mockReturnValue(adapterRegistry);
    const database = {
      accounts: {},
      profiles: {},
    };
    const eventBus = { emit: vi.fn() };
    const providerRuntime = { cleanup: vi.fn() };

    mockBuildProcessingPorts.mockReturnValue(ports);

    const result = createCliProcessingWorkflowRuntime({
      adapterRegistryFactory,
      assetReviewProjectionFactory,
      dataDir: '/tmp/exitbook',
      database: database as never,
      eventBus: eventBus as never,
      providerRuntime: providerRuntime as never,
    });

    assertOk(result);
    expect(adapterRegistryFactory).toHaveBeenCalledWith({ nearBatchSource });
    expect(mockProcessingWorkflow).toHaveBeenCalledWith(ports, providerRuntime, eventBus, adapterRegistry);
  });

  it('passes an interpretation rebuild callback into processing ports', async () => {
    const nearBatchSource = { fetch: vi.fn() };
    const ports = { nearBatchSource };
    const database = {
      accounts: {},
      profiles: {},
    };

    mockBuildProcessingPorts.mockReturnValue(ports);

    const result = createCliProcessingWorkflowRuntime({
      adapterRegistryFactory: vi.fn().mockReturnValue({}),
      assetReviewProjectionFactory,
      dataDir: '/tmp/exitbook',
      database: database as never,
      eventBus: { emit: vi.fn() } as never,
      providerRuntime: { cleanup: vi.fn() } as never,
    });

    assertOk(result);
    const buildProcessingPortsCall = mockBuildProcessingPorts.mock.calls[0] as
      | [unknown, { rebuildTransactionInterpretation: (accountIds: number[]) => Promise<Result<void, Error>> }]
      | undefined;
    expect(buildProcessingPortsCall).toBeDefined();
    if (buildProcessingPortsCall === undefined) {
      return;
    }

    const buildOptions = buildProcessingPortsCall[1];
    expect(buildOptions.rebuildTransactionInterpretation).toEqual(expect.any(Function));
    assertOk(await buildOptions.rebuildTransactionInterpretation([]));
  });

  it('rebuilds only the profiles that own the processed accounts', async () => {
    const database = {
      accounts: {
        getById: vi.fn().mockImplementation(async (accountId: number) => {
          if (accountId === 1) {
            return ok({ id: 1, profileId: 10 });
          }

          if (accountId === 2) {
            return ok({ id: 2, profileId: 10 });
          }

          if (accountId === 3) {
            return ok({ id: 3, profileId: 20 });
          }

          return ok(undefined);
        }),
      },
      profiles: {
        list: vi.fn().mockResolvedValue(
          ok([
            { id: 10, profileKey: 'default' },
            { id: 20, profileKey: 'business' },
            { id: 30, profileKey: 'archived' },
          ])
        ),
      },
    };

    assertOk(
      await rebuildCliAssetReviewProjectionsForAccounts(database as never, [1, 2, 3], assetReviewProjectionFactory)
    );

    expect(createForProfile).toHaveBeenCalledTimes(2);
    expect(createForProfile).toHaveBeenNthCalledWith(1, {
      profileId: 10,
      profileKey: 'default',
    });
    expect(createForProfile).toHaveBeenNthCalledWith(2, {
      profileId: 20,
      profileKey: 'business',
    });
    expect(mockRebuild).toHaveBeenCalledTimes(2);
  });
});
