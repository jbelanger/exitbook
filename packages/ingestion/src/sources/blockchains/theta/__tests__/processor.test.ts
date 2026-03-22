import { type IBlockchainProviderManager } from '@exitbook/blockchain-providers';
import { type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import { THETA_CHAINS } from '@exitbook/blockchain-providers/theta';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, ok, type Currency } from '@exitbook/core';
import { describe, expect, test, vi } from 'vitest';

import { assertOk } from '../../../../../../core/src/__tests__/test-utils.js';
import { ThetaProcessor } from '../processor.js';

const THETA_CONFIG = (() => {
  const config = THETA_CHAINS['theta'];
  if (!config) {
    throw new Error('Theta test config is missing');
  }
  return config;
})();
const USER_ADDRESS = '0xuser00000000000000000000000000000000000000';
const EXTERNAL_ADDRESS = '0xexternal000000000000000000000000000000000';
const TOKEN_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

type ThetaProviderManagerMock = Pick<IBlockchainProviderManager, 'getAddressInfo' | 'getTokenMetadata'> & {
  getAddressInfo: ReturnType<typeof vi.fn>;
  getTokenMetadata: ReturnType<typeof vi.fn>;
};

function createMockProviderManager(isContract = false): ThetaProviderManagerMock {
  return {
    getAddressInfo: vi.fn().mockResolvedValue(
      ok({
        data: { isContract },
        providerName: 'mock',
      })
    ),
    getTokenMetadata: vi.fn().mockResolvedValue(ok(new Map())),
  };
}

function createThetaProcessor(providerManager?: ThetaProviderManagerMock) {
  return new ThetaProcessor(
    THETA_CONFIG,
    (providerManager ?? createMockProviderManager()) as unknown as IBlockchainProviderManager
  );
}

function createTransaction(overrides: Partial<EvmTransaction> = {}): EvmTransaction {
  return {
    amount: '1000000000000000000',
    currency: 'TFUEL',
    eventId: 'event1',
    feeAmount: '21000000000000',
    feeCurrency: 'TFUEL' as Currency,
    from: EXTERNAL_ADDRESS,
    id: '0xhash1',
    providerName: 'thetascan',
    status: 'success',
    timestamp: Date.now(),
    to: USER_ADDRESS,
    tokenSymbol: 'TFUEL',
    tokenType: 'native',
    type: 'transfer',
    ...overrides,
  };
}

describe('ThetaProcessor', () => {
  test('maps TFUEL movements to the native Theta asset id', async () => {
    const processor = createThetaProcessor();

    const result = await processor.process([createTransaction()], {
      primaryAddress: USER_ADDRESS,
      userAddresses: [USER_ADDRESS],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [transaction] = result.value;
    expect(result.value).toHaveLength(1);
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.movements.inflows?.[0]?.assetId).toBe(assertOk(buildBlockchainNativeAssetId('theta')));
    expect(transaction.movements.inflows?.[0]?.assetSymbol).toBe('TFUEL');
  });

  test('maps THETA movements to the symbol-based native asset id and keeps TFUEL fees native', async () => {
    const providerManager = createMockProviderManager();
    const processor = createThetaProcessor(providerManager);

    const result = await processor.process(
      [
        createTransaction({
          amount: '42',
          currency: 'THETA',
          feeAmount: '500000000000000000',
          feeCurrency: 'TFUEL' as Currency,
          from: USER_ADDRESS,
          id: '0xhash2',
          timestamp: Date.now(),
          to: EXTERNAL_ADDRESS,
          tokenSymbol: 'THETA',
          tokenType: 'native',
          type: 'token_transfer',
        }),
      ],
      {
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.movements.outflows?.[0]?.assetId).toBe(assertOk(buildBlockchainTokenAssetId('theta', 'theta')));
    expect(transaction.fees[0]?.assetId).toBe(assertOk(buildBlockchainNativeAssetId('theta')));
    expect(transaction.fees[0]?.assetSymbol).toBe('TFUEL');
    expect(providerManager.getTokenMetadata).not.toHaveBeenCalled();
  });

  test('uses contract-address asset ids for real Theta token contracts and enriches metadata', async () => {
    const providerManager = createMockProviderManager();
    providerManager.getTokenMetadata.mockResolvedValue(
      ok(
        new Map([
          [
            TOKEN_ADDRESS,
            {
              address: TOKEN_ADDRESS,
              blockchain: 'theta',
              decimals: 6,
              symbol: 'USDC',
            },
          ],
        ])
      )
    );

    const processor = createThetaProcessor(providerManager);

    const result = await processor.process(
      [
        createTransaction({
          amount: '1000000',
          currency: 'USDC',
          feeAmount: '100000000000000000',
          feeCurrency: 'TFUEL' as Currency,
          from: USER_ADDRESS,
          id: '0xhash3',
          timestamp: Date.now(),
          to: EXTERNAL_ADDRESS,
          tokenAddress: TOKEN_ADDRESS,
          tokenDecimals: 6,
          tokenSymbol: 'USDC',
          tokenType: 'erc20',
          type: 'token_transfer',
        }),
      ],
      {
        primaryAddress: USER_ADDRESS,
        userAddresses: [USER_ADDRESS],
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(providerManager.getTokenMetadata).toHaveBeenCalledWith('theta', [TOKEN_ADDRESS]);
    expect(transaction.movements.outflows?.[0]?.assetId).toBe(
      assertOk(buildBlockchainTokenAssetId('theta', TOKEN_ADDRESS))
    );
    expect(transaction.fees[0]?.assetId).toBe(assertOk(buildBlockchainNativeAssetId('theta')));
  });
});
