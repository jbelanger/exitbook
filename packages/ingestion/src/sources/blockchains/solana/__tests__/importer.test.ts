import { type IBlockchainProviderRuntime, ProviderError } from '@exitbook/blockchain-providers';
import { err, ok } from '@exitbook/foundation';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  assertOk,
  consumeImportStream,
  createMockProviderManager,
  type ProviderManagerMock,
} from '../../../../shared/test-utils/importer-test-utils.js';
import { SolanaImporter } from '../importer.js';

const mockSolTx = {
  signature: 'sig123abc',
  slot: 100000,
  from: 'user1111111111111111111111111111111111111111',
  to: 'user2222222222222222222222222222222222222222',
  amount: '1000000000', // 1 SOL in lamports
  fee: '5000',
};

const mockTokenTx = {
  signature: 'sig456def',
  slot: 100001,
  from: 'user1111111111111111111111111111111111111111',
  to: 'user2222222222222222222222222222222222222222',
  tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '1000000', // 1 USDC (6 decimals)
};

const STAKE_ACCOUNT = 'stake111111111111111111111111111111111111111';

describe('SolanaImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  /**
   * Helper to setup mock for transaction data
   */
  const setupMockData = (normalData: unknown[] = [], tokenData: unknown[] = [], stakeData: unknown[] = []) => {
    mockProviderManager.streamAddressTransactions.mockImplementation(async function* (_blockchain, _address, options) {
      const data =
        options?.streamType === 'stake' ? stakeData : options?.streamType === 'normal' ? normalData : tokenData;
      yield ok({
        data,
        providerName: 'helius',
        cursor: {
          primary: { type: 'blockNumber' as const, value: 0 },
          lastTransactionId: '',
          totalFetched: data.length,
          metadata: { providerName: 'helius', updatedAt: Date.now(), isComplete: true },
        },
        isComplete: true,
        stats: { fetched: 0, deduplicated: 0, yielded: 0 },
      });
    });
  };

  beforeEach(() => {
    mockProviderManager = createMockProviderManager('solana');
  });

  const createImporter = (options?: { preferredProvider?: string | undefined }): SolanaImporter =>
    new SolanaImporter(mockProviderManager as unknown as IBlockchainProviderRuntime, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Solana provider manager', () => {
      const importer = createImporter();

      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('solana', { preferredProvider: undefined });
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter({
        preferredProvider: 'helius',
      });

      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('solana', { preferredProvider: 'helius' });
      expect(importer).toBeDefined();
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      const mockNormalizedSol = { id: 'sig123abc', eventId: '0'.repeat(64), amount: '1', currency: 'SOL' };
      const mockNormalizedToken = { id: 'sig456def', eventId: '1'.repeat(64), amount: '1', currency: 'USDC' };

      setupMockData([
        { normalized: mockNormalizedSol, raw: mockSolTx },
        { normalized: mockNormalizedToken, raw: mockTokenTx },
      ]);

      const result = await consumeImportStream(importer, {
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        address,
      });

      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(2);

      // Verify SOL transaction
      expect(value.rawTransactions[0]).toMatchObject({
        providerName: 'helius',
        sourceAddress: address,
        normalizedData: mockNormalizedSol,
        providerData: mockSolTx,
      });
      expect(value.rawTransactions[0]?.eventId).toMatch(/^[a-f0-9]{64}$/);

      // Verify token transaction
      expect(value.rawTransactions[1]).toMatchObject({
        providerName: 'helius',
        sourceAddress: address,
        normalizedData: mockNormalizedToken,
        providerData: mockTokenTx,
      });
      expect(value.rawTransactions[1]?.eventId).toMatch(/^[a-f0-9]{64}$/);

      // Verify API call was made
      expect(mockProviderManager.streamAddressTransactions).toHaveBeenCalledTimes(2);

      const executeCalls: Parameters<IBlockchainProviderRuntime['streamAddressTransactions']>[] =
        mockProviderManager.streamAddressTransactions.mock.calls;

      const [, address1, options1] = executeCalls[0]!;
      expect(address1).toBe(address);
      expect(options1?.preferredProvider).toBeUndefined();
      expect(options1?.streamType).toBe('normal');

      const [, address2, options2] = executeCalls[1]!;
      expect(address2).toBe(address);
      expect(options2?.preferredProvider).toBeUndefined();
      expect(options2?.streamType).toBe('token');
    });

    test('streams discovered stake accounts before wallet and token streams', async () => {
      mockProviderManager.getProviders.mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getAddressStakingBalances'],
          },
        },
      ] as never);
      mockProviderManager.getAddressStakingBalances.mockResolvedValue(
        ok({
          data: [
            {
              accountAddress: STAKE_ACCOUNT,
              rawAmount: '2500000000',
              decimalAmount: '2.5',
              symbol: 'SOL',
              decimals: 9,
              balanceCategory: 'staked',
            },
          ],
          providerName: 'helius',
        })
      );

      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';
      const mockNormalizedStake = { id: 'sig-stake', eventId: '2'.repeat(64), providerName: 'helius' };
      const mockNormalizedSol = { id: 'sig-normal', eventId: '0'.repeat(64), providerName: 'helius' };
      const mockNormalizedToken = { id: 'sig-token', eventId: '1'.repeat(64), providerName: 'helius' };

      setupMockData(
        [{ normalized: mockNormalizedSol, raw: mockSolTx }],
        [{ normalized: mockNormalizedToken, raw: mockTokenTx }],
        [{ normalized: mockNormalizedStake, raw: { signature: 'sig-stake' } }]
      );

      const result = await consumeImportStream(importer, {
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        address,
      });

      const value = assertOk(result);
      expect(value.rawTransactions.map((transaction) => transaction.sourceAddress)).toEqual([
        STAKE_ACCOUNT,
        address,
        address,
      ]);
      expect(value.rawTransactions[0]?.normalizedData).toMatchObject({
        ...mockNormalizedStake,
        importSourceAddress: STAKE_ACCOUNT,
        importSourceKind: 'stake_account',
      });
      expect(
        mockProviderManager.streamAddressTransactions.mock.calls.map((call) => [call[1], call[2]?.streamType])
      ).toEqual([
        [STAKE_ACCOUNT, 'stake'],
        [address, 'normal'],
        [address, 'token'],
      ]);
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      setupMockData([]);

      const result = await consumeImportStream(importer, {
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        address,
      });

      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(0);
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      const tx1 = mockSolTx;
      const tx2 = { ...mockSolTx, signature: 'sig789' };
      const tx3 = { ...mockSolTx, signature: 'sig012' };

      const multipleTxs = [
        { normalized: { id: 'sig123abc', eventId: '0'.repeat(64) }, raw: tx1 },
        { normalized: { id: 'sig789', eventId: '1'.repeat(64) }, raw: tx2 },
        { normalized: { id: 'sig012', eventId: '2'.repeat(64) }, raw: tx3 },
      ];

      setupMockData(multipleTxs);

      const result = await consumeImportStream(importer, {
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        address,
      });

      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(3);
      expect(value.rawTransactions[0]!.providerData).toEqual(mockSolTx);
      expect(value.rawTransactions[1]!.providerData).toEqual({ ...mockSolTx, signature: 'sig789' });
      expect(value.rawTransactions[2]!.providerData).toEqual({ ...mockSolTx, signature: 'sig012' });
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if provider fails', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      mockProviderManager.streamAddressTransactions.mockImplementation(async function* () {
        yield err(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'solana',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
        address,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, {
        platformKey: 'solana',
        platformKind: 'blockchain' as const,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Solana transaction import');
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache key', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      setupMockData([]);

      await consumeImportStream(importer, { platformKey: 'solana', platformKind: 'blockchain' as const, address });

      const calls: Parameters<IBlockchainProviderRuntime['streamAddressTransactions']>[] =
        mockProviderManager.streamAddressTransactions.mock.calls;

      expect(calls[0]?.[0]).toBe('solana');
      expect(calls[0]?.[1]).toBe(address);
    });
  });
});
