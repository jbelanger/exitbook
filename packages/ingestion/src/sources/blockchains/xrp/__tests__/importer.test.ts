/**
 * Unit tests for the XRP importer
 * Tests transaction fetching with provider failover
 */

import { type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import { getXrpChainConfig } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { consumeImportStream, type ProviderManagerMock } from '../../../../shared/test-utils/importer-test-utils.js';
import { XrpTransactionImporter } from '../importer.js';

const USER_ADDRESS = 'rN7n7otQDd6FczFgLdhmKRAWNZDy7g4EAZ';
const EXTERNAL_ADDRESS = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

const mockXrpTx = {
  id: 'tx1abc',
  eventId: '0xeventid1',
  account: EXTERNAL_ADDRESS,
  currency: 'XRP',
  destination: USER_ADDRESS,
  feeAmount: '0.000012',
  feeCurrency: 'XRP',
  ledgerIndex: 12345678,
  providerName: 'xrpl-rpc',
  sequence: 1,
  status: 'success' as const,
  timestamp: Math.floor(Date.now() / 1000),
  transactionType: 'Payment',
  balanceChanges: [
    {
      account: USER_ADDRESS,
      balance: '100.5',
      currency: 'XRP',
      previousBalance: '100',
    },
  ],
};

describe('XrpTransactionImporter', () => {
  let mockProviderManager: ProviderManagerMock;
  let importer: XrpTransactionImporter;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProviderManager = {
      autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
      executeWithFailover: vi.fn<BlockchainProviderManager['executeWithFailover']>(),
      getProviders: vi.fn<BlockchainProviderManager['getProviders']>(),
    } as unknown as ProviderManagerMock;

    mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);
    mockProviderManager.getProviders.mockReturnValue([{ name: 'xrpl-rpc' }] as unknown);

    const chainConfig = getXrpChainConfig('xrp');
    if (!chainConfig) {
      throw new Error('XRP chain config not found');
    }
    importer = new XrpTransactionImporter(chainConfig, mockProviderManager as unknown as BlockchainProviderManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('successfully fetches transactions', async () => {
    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield okAsync({
        data: [{ normalized: mockXrpTx, raw: {} }],
        cursor: {
          primary: { type: 'pageToken' as const, value: 'marker1', providerName: 'xrpl-rpc' },
          lastTransactionId: 'tx1abc',
          totalFetched: 1,
        },
        isComplete: true,
        providerName: 'xrpl-rpc',
        stats: {
          fetched: 1,
          deduplicated: 0,
          yielded: 1,
        },
      });
    });

    const result = await consumeImportStream(importer, {
      address: USER_ADDRESS,
      sourceName: 'xrp',
      sourceType: 'blockchain',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const importResult = result.value;
    expect(importResult.rawTransactions).toHaveLength(1);
    expect(importResult.rawTransactions[0]?.blockchainTransactionHash).toBe('tx1abc');

    // Verify provider manager was called correctly
    expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(1);
    const executeArgs = mockProviderManager.executeWithFailover.mock.calls[0];
    if (!executeArgs) throw new Error('executeWithFailover was not called');
    expect(executeArgs[0]).toBe('xrp');
    assertOperationType(executeArgs[1], 'getAddressTransactions');
    expect(executeArgs[1].address).toBe(USER_ADDRESS);
  });

  test('handles provider errors', async () => {
    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield errAsync(new ProviderError('API error', 'NO_PROVIDERS'));
    });

    const result = await consumeImportStream(importer, {
      address: USER_ADDRESS,
      sourceName: 'xrp',
      sourceType: 'blockchain',
    });

    expect(result.isErr()).toBe(true);
  });

  test('requires address parameter', async () => {
    const result = await consumeImportStream(importer, {
      sourceName: 'xrp',
      sourceType: 'blockchain',
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.message).toContain('Address required');
  });

  test('handles multiple batches', async () => {
    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield okAsync({
        data: [{ normalized: mockXrpTx, raw: {} }],
        cursor: {
          primary: { type: 'pageToken' as const, value: 'marker1', providerName: 'xrpl-rpc' },
          lastTransactionId: 'tx1abc',
          totalFetched: 1,
        },
        isComplete: false,
        providerName: 'xrpl-rpc',
        stats: {
          fetched: 1,
          deduplicated: 0,
          yielded: 1,
        },
      });
      yield okAsync({
        data: [{ normalized: { ...mockXrpTx, id: 'tx2def', eventId: '0xeventid2' }, raw: {} }],
        cursor: {
          primary: { type: 'pageToken' as const, value: 'marker2', providerName: 'xrpl-rpc' },
          lastTransactionId: 'tx2def',
          totalFetched: 2,
        },
        isComplete: true,
        providerName: 'xrpl-rpc',
        stats: {
          fetched: 1,
          deduplicated: 0,
          yielded: 1,
        },
      });
    });

    const result = await consumeImportStream(importer, {
      address: USER_ADDRESS,
      sourceName: 'xrp',
      sourceType: 'blockchain',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const importResult = result.value;
    expect(importResult.rawTransactions).toHaveLength(2);
  });

  test('supports resume with cursor', async () => {
    const resumeCursor = {
      primary: { type: 'pageToken' as const, value: 'resume123', providerName: 'xrpl-rpc' },
      lastTransactionId: 'txPrev',
      totalFetched: 100,
    };

    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield okAsync({
        data: [{ normalized: mockXrpTx, raw: {} }],
        cursor: {
          primary: { type: 'pageToken' as const, value: 'marker1', providerName: 'xrpl-rpc' },
          lastTransactionId: 'tx1abc',
          totalFetched: 101,
        },
        isComplete: true,
        providerName: 'xrpl-rpc',
        stats: {
          fetched: 1,
          deduplicated: 0,
          yielded: 1,
        },
      });
    });

    await consumeImportStream(importer, {
      address: USER_ADDRESS,
      sourceName: 'xrp',
      sourceType: 'blockchain',
      cursor: { normal: resumeCursor },
    });

    expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(1);
    const executeArgs = mockProviderManager.executeWithFailover.mock.calls[0];
    if (!executeArgs) throw new Error('executeWithFailover was not called');
    expect(executeArgs[2]).toEqual(resumeCursor);
  });
});
