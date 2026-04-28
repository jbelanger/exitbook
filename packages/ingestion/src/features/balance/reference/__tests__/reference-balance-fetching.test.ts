import type {
  FailoverExecutionResult,
  IBlockchainProviderRuntime,
  RawBalanceData,
} from '@exitbook/blockchain-providers';
import { ok, type Result } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { buildReferenceBalanceAssetScreeningPolicy } from '../../../asset-screening/index.js';
import { fetchBlockchainBalance } from '../reference-balance-fetching.js';

const SOLANA_ADDRESS = 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm';
const STAKE_ACCOUNT = 'StakeAcct1111111111111111111111111111111111';

type RuntimeMock = IBlockchainProviderRuntime & {
  getAddressStakingBalances: ReturnType<typeof vi.fn>;
  getAddressTokenBalances: ReturnType<typeof vi.fn>;
};

function expectOk<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw result.error;
  }
  return result.value;
}

function createRuntime(params: {
  nativeBalance: RawBalanceData;
  stakingBalances?: RawBalanceData[] | undefined;
  supportedOperations?: string[] | undefined;
}): RuntimeMock {
  const provider = {
    capabilities: {
      supportedOperations: params.supportedOperations ?? ['getAddressBalances', 'getAddressStakingBalances'],
    },
  };
  const nativeResult: FailoverExecutionResult<RawBalanceData> = {
    data: params.nativeBalance,
    providerName: 'mock-provider',
  };
  const stakingResult: FailoverExecutionResult<RawBalanceData[]> = {
    data: params.stakingBalances ?? [],
    providerName: 'mock-provider',
  };

  return {
    getProviders: vi.fn().mockReturnValue([provider]),
    getAddressBalances: vi.fn().mockResolvedValue(ok(nativeResult)),
    getAddressStakingBalances: vi.fn().mockResolvedValue(ok(stakingResult)),
    getAddressTokenBalances: vi.fn(),
    getTokenMetadata: vi.fn().mockResolvedValue(ok(new Map())),
    hasRegisteredOperationSupport: vi.fn((_: string, operation: string) =>
      provider.capabilities.supportedOperations.includes(operation)
    ),
  } as unknown as RuntimeMock;
}

describe('reference balance fetching', () => {
  it('emits separate Solana liquid and staking balance rows', async () => {
    const runtime = createRuntime({
      nativeBalance: {
        rawAmount: '1000000000',
        decimalAmount: '1',
        decimals: 9,
        symbol: 'SOL',
        balanceCategory: 'liquid',
      },
      stakingBalances: [
        {
          accountAddress: STAKE_ACCOUNT,
          rawAmount: '2500000000',
          decimalAmount: '2.5',
          decimals: 9,
          symbol: 'SOL',
          balanceCategory: 'staked',
        },
      ],
    });

    const snapshot = expectOk(await fetchBlockchainBalance(runtime, 'solana', SOLANA_ADDRESS));

    expect(snapshot.balances).toEqual({
      'blockchain:solana:native': '1',
    });
    expect(snapshot.balanceRows).toEqual([
      {
        amount: '1',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'liquid',
      },
      {
        amount: '2.5',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'staked',
        refs: [`provider-account:${STAKE_ACCOUNT}`],
      },
    ]);
  });

  it('fetches staking balances when tracked-reference screening has no token allowlist entries', async () => {
    const screeningPolicyResult = buildReferenceBalanceAssetScreeningPolicy({
      blockchain: 'solana',
      calculatedAssetIds: ['blockchain:solana:native'],
    });
    const assetScreeningPolicy = expectOk(screeningPolicyResult);
    expect(assetScreeningPolicy.getTokenContractAllowlist('solana')).toEqual([]);

    const runtime = createRuntime({
      nativeBalance: {
        rawAmount: '1000000000',
        decimalAmount: '1',
        decimals: 9,
        symbol: 'SOL',
        balanceCategory: 'liquid',
      },
      supportedOperations: ['getAddressBalances', 'getAddressTokenBalances', 'getAddressStakingBalances'],
      stakingBalances: [
        {
          accountAddress: STAKE_ACCOUNT,
          rawAmount: '2500000000',
          decimalAmount: '2.5',
          decimals: 9,
          symbol: 'SOL',
          balanceCategory: 'staked',
        },
      ],
    });

    const snapshot = expectOk(
      await fetchBlockchainBalance(runtime, 'solana', SOLANA_ADDRESS, {
        assetScreeningPolicy,
      })
    );

    expect(runtime.getAddressTokenBalances.mock.calls).toHaveLength(0);
    expect(runtime.getAddressStakingBalances.mock.calls).toEqual([
      [
        'solana',
        SOLANA_ADDRESS,
        {
          preferredProvider: undefined,
        },
      ],
    ]);
    expect(snapshot.balanceRows).toEqual([
      {
        amount: '1',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'liquid',
      },
      {
        amount: '2.5',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'staked',
        refs: [`provider-account:${STAKE_ACCOUNT}`],
      },
    ]);
  });
});
