/**
 * Unit tests for the generic EVM importer
 * Tests the three-method fetch pattern (normal, internal, token) across multiple chains
 */

import { type BlockchainProviderManager, type EvmChainConfig, ProviderError } from '@exitbook/blockchain-providers';
import type { Currency, PaginationCursor } from '@exitbook/core';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
import { EvmImporter } from '../importer.js';

const ETHEREUM_CONFIG: EvmChainConfig = {
  chainId: 1,
  chainName: 'ethereum',
  nativeCurrency: 'ETH' as Currency,
  nativeDecimals: 18,
  transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
};

const AVALANCHE_CONFIG: EvmChainConfig = {
  chainId: 43114,
  chainName: 'avalanche',
  nativeCurrency: 'AVAX' as Currency,
  nativeDecimals: 18,
  transactionTypes: ['normal', 'token'],
};

const mockNormalTx = { hash: '0x123', from: '0xabc', to: '0xdef', value: '1000000000000000000' };
const mockInternalTx = { hash: '0x123', from: '0xdef', to: '0xghi', value: '500000000000000000' };
const mockTokenTx = {
  hash: '0x456',
  from: '0xabc',
  to: '0xdef',
  tokenAddress: '0xtoken',
  value: '1000000',
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'streamAddressTransactions' | 'getProviders'>
>;

describe('EvmImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  /**
   * Helper to setup mocks for all transaction types (normal, internal, token, optional beacon_withdrawal)
   */
  const setupDefaultMocks = (
    normalData: unknown[] = [],
    internalData: unknown[] = [],
    tokenData: unknown[] = [],
    beaconData?: unknown[]
  ) => {
    const mock = mockProviderManager.streamAddressTransactions
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: normalData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: normalData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      })
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: internalData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: internalData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      })
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: tokenData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: tokenData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });

    // Only mock beacon withdrawals if explicitly provided
    if (beaconData !== undefined) {
      mock.mockImplementationOnce(async function* () {
        yield okAsync({
          data: beaconData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: beaconData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });
    }
  };

  beforeEach(() => {
    mockProviderManager = {
      autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
      streamAddressTransactions: vi.fn<BlockchainProviderManager['streamAddressTransactions']>(),
      getProviders: vi.fn<BlockchainProviderManager['getProviders']>(),
    } as unknown as ProviderManagerMock;

    mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);
    mockProviderManager.getProviders.mockReturnValue([
      {
        name: 'mock-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedTransactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
        },
        execute: vi.fn(),
        isHealthy: vi.fn().mockResolvedValue(true),
        rateLimit: { requestsPerSecond: 1 },
        executeStreaming: vi.fn(async function* () {
          yield errAsync(new Error('Streaming not implemented in mock'));
        }),
        extractCursors: vi.fn((_transaction: unknown): PaginationCursor[] => []),
        applyReplayWindow: vi.fn((cursor: PaginationCursor): PaginationCursor => cursor),
        destroy: vi.fn(),
      },
    ]);
  });

  const createImporter = (
    config: EvmChainConfig = ETHEREUM_CONFIG,
    options?: { preferredProvider?: string | undefined }
  ): EvmImporter => new EvmImporter(config, mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Ethereum config', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('ethereum', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('ethereum');
      expect(importer).toBeDefined();
    });

    test('should initialize with Avalanche config', () => {
      const importer = createImporter(AVALANCHE_CONFIG);

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('avalanche', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('avalanche');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter(ETHEREUM_CONFIG, {
        preferredProvider: 'alchemy',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('ethereum', 'alchemy');
      expect(importer).toBeDefined();
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch all transaction types', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks(
        [
          {
            raw: mockNormalTx,
            normalized: { id: mockNormalTx.hash, eventId: '0'.repeat(64), type: 'transfer' as const },
          },
        ],
        [
          {
            raw: mockInternalTx,
            normalized: { id: mockInternalTx.hash, eventId: '1'.repeat(64), type: 'internal' as const },
          },
        ],
        [
          {
            raw: mockTokenTx,
            normalized: { id: mockTokenTx.hash, eventId: '2'.repeat(64), type: 'token_transfer' as const },
          },
        ],
        [] // Beacon withdrawals (empty for Ethereum)
      );

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);

        // Verify normal transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'normal',
          providerData: mockNormalTx,
          normalizedData: { id: mockNormalTx.hash, eventId: '0'.repeat(64) },
        });
        expect(result.value.rawTransactions[0]?.eventId).toMatch(/^[a-f0-9]{64}$/);

        // Verify internal transaction
        expect(result.value.rawTransactions[1]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'internal',
          providerData: mockInternalTx,
          normalizedData: { id: mockInternalTx.hash, eventId: '1'.repeat(64) },
        });
        expect(result.value.rawTransactions[1]?.eventId).toMatch(/^[a-f0-9]{64}$/);

        // Verify token transaction
        expect(result.value.rawTransactions[2]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'token',
          providerData: mockTokenTx,
          normalizedData: { id: mockTokenTx.hash, eventId: '2'.repeat(64) },
        });
        expect(result.value.rawTransactions[2]?.eventId).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify all four API calls were made (one for each Ethereum transaction type)
      expect(mockProviderManager.streamAddressTransactions).toHaveBeenCalledTimes(4);

      const executeCalls: Parameters<BlockchainProviderManager['streamAddressTransactions']>[] =
        mockProviderManager.streamAddressTransactions.mock.calls;

      const [, normalAddr, normalOpts] = executeCalls[0]!;
      expect(normalAddr).toBe(address);
      expect(normalOpts?.streamType).toBe('normal');

      const [, internalAddr, internalOpts] = executeCalls[1]!;
      expect(internalAddr).toBe(address);
      expect(internalOpts?.streamType).toBe('internal');

      const [, tokenAddr, tokenOpts] = executeCalls[2]!;
      expect(tokenAddr).toBe(address);
      expect(tokenOpts?.streamType).toBe('token');

      const [, beaconAddr, beaconOpts] = executeCalls[3]!;
      expect(beaconAddr).toBe(address);
      expect(beaconOpts?.streamType).toBe('beacon_withdrawal');
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if normal transactions fail', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // First call (normal) fails
      mockProviderManager.streamAddressTransactions.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch normal transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'ethereum',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch normal transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, { sourceName: 'evm', sourceType: 'blockchain' as const });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for ethereum transaction import');
      }
    });

    test('should yield warning batch when beacon withdrawals fail', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Add beacon withdrawal support to mock provider
      const providers = mockProviderManager.getProviders('ethereum');
      if (providers.length > 0) {
        providers[0]!.capabilities.supportedOperations = ['getAddressTransactions'];
        providers[0]!.capabilities.supportedTransactionTypes = ['normal', 'internal', 'token', 'beacon_withdrawal'];
      }

      // Setup mocks: normal, internal, token succeed; beacon withdrawals fail
      setupDefaultMocks([], [], []);

      // Fourth call (beacon withdrawals) fails
      mockProviderManager.streamAddressTransactions.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Invalid API Key provided', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'ethereum',
            lastError: 'Invalid API Key provided',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have empty raw transactions (beacon withdrawals failed)
        expect(result.value.rawTransactions).toHaveLength(0);

        // Should have warning batch with valid cursor
        expect(result.value.warnings).toBeDefined();
        expect(result.value.warnings?.length).toBeGreaterThan(0);

        // Verify warning message includes helpful context
        const warning = result.value.warnings?.[0];
        expect(warning).toContain('Failed to fetch beacon withdrawals');
        expect(warning).toContain('Invalid API Key provided');
        expect(warning).toContain('ETHERSCAN_API_KEY');

        // Verify cursor structure is valid
        const beaconCursor = result.value.cursorUpdates['beacon_withdrawal'];
        expect(beaconCursor).toBeDefined();
        expect(beaconCursor?.primary.type).toBe('blockNumber');
        expect(beaconCursor?.lastTransactionId).toBe('FETCH_FAILED');
        expect(beaconCursor?.metadata?.['fetchStatus']).toBe('failed');
        expect(beaconCursor?.metadata?.['errorMessage']).toContain('Invalid API Key provided');
      }

      // Verify streamAddressTransactions was called 4 times (normal, internal, token, beacon_withdrawal)
      expect(mockProviderManager.streamAddressTransactions).toHaveBeenCalledTimes(4);

      // Verify the fourth call was for beacon withdrawals
      const executeCalls: Parameters<BlockchainProviderManager['streamAddressTransactions']>[] =
        mockProviderManager.streamAddressTransactions.mock.calls;
      const [, beaconAddr, beaconOpts] = executeCalls[3]!;
      expect(beaconAddr).toBe(address);
      expect(beaconOpts?.streamType).toBe('beacon_withdrawal');
    });
  });

  describe('Multi-Chain Support', () => {
    test('should work with Avalanche config', async () => {
      const importer = createImporter(AVALANCHE_CONFIG);
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks(
        [
          {
            raw: mockNormalTx,
            normalized: { id: mockNormalTx.hash, eventId: '0'.repeat(64), type: 'transfer' as const },
          },
        ],
        [],
        []
      );

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'avalanche' blockchain name
      // Avalanche only supports normal and token transactions (no internal)
      const executeCalls: Parameters<BlockchainProviderManager['streamAddressTransactions']>[] =
        mockProviderManager.streamAddressTransactions.mock.calls;

      expect(executeCalls.length).toBe(2);
      expect(executeCalls[0]?.[0]).toBe('avalanche');
      expect(executeCalls[1]?.[0]).toBe('avalanche');

      const [, normalAddr2, normalOpts2] = executeCalls[0]!;
      expect(normalAddr2).toBe(address);
      expect(normalOpts2?.streamType).toBe('normal');

      const [, tokenAddr2, tokenOpts2] = executeCalls[1]!;
      expect(tokenAddr2).toBe(address);
      expect(tokenOpts2?.streamType).toBe('token');
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      const multipleNormalTxs = [
        {
          raw: mockNormalTx,
          normalized: { id: mockNormalTx.hash, eventId: '0'.repeat(64), type: 'transfer' as const },
        },
        {
          raw: { ...mockNormalTx, hash: '0x789' },
          normalized: { id: '0x789', eventId: '1'.repeat(64), type: 'transfer' as const },
        },
      ];

      setupDefaultMocks(multipleNormalTxs, [], [], []);

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(2);
        expect(result.value.rawTransactions[0]!.providerData).toEqual(mockNormalTx);
        expect(result.value.rawTransactions[1]!.providerData).toEqual({ ...mockNormalTx, hash: '0x789' });
      }
    });
  });
});
