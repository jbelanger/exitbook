import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { THETA_CHAINS } from '@exitbook/blockchain-providers/theta';
import { err, ok, type PaginationCursor } from '@exitbook/foundation';
import { beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
import { ThetaImporter } from '../importer.js';

type ProviderManagerMock = Mocked<Pick<IBlockchainProviderRuntime, 'streamAddressTransactions' | 'getProviders'>>;

const THETA_CONFIG = (() => {
  const config = THETA_CHAINS['theta'];
  if (!config) {
    throw new Error('Theta test config is missing');
  }
  return config;
})();
const TEST_ADDRESS = '0x1111111111111111111111111111111111111111';

describe('ThetaImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  beforeEach(() => {
    mockProviderManager = {
      streamAddressTransactions: vi.fn<IBlockchainProviderRuntime['streamAddressTransactions']>(),
      getProviders: vi.fn<IBlockchainProviderRuntime['getProviders']>(),
    } as unknown as ProviderManagerMock;
    mockProviderManager.getProviders.mockReturnValue([
      {
        name: 'thetascan',
        blockchain: 'theta',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedTransactionTypes: ['normal'],
        },
        execute: vi.fn(),
        isHealthy: vi.fn().mockResolvedValue(true),
        rateLimit: { requestsPerSecond: 1 },
        executeStreaming: vi.fn(async function* () {
          yield err(new Error('Streaming not implemented in mock'));
        }),
        extractCursors: vi.fn((_transaction: unknown): PaginationCursor[] => []),
        applyReplayWindow: vi.fn((cursor: PaginationCursor): PaginationCursor => cursor),
        destroy: vi.fn(),
      },
    ]);
  });

  function createImporter(options?: { preferredProvider?: string | undefined }): ThetaImporter {
    return new ThetaImporter(THETA_CONFIG, mockProviderManager as unknown as IBlockchainProviderRuntime, options);
  }

  test('registers Theta providers for the selected chain', () => {
    createImporter({ preferredProvider: 'thetascan' });

    expect(mockProviderManager.getProviders).toHaveBeenCalledWith('theta', { preferredProvider: 'thetascan' });
  });

  test('streams the normal Theta transaction feed', async () => {
    mockProviderManager.streamAddressTransactions.mockImplementationOnce(async function* () {
      yield ok({
        data: [
          {
            raw: { hash: '0xtheta1' },
            normalized: {
              eventId: 'a'.repeat(64),
              id: '0xtheta1',
              timestamp: 1700000000000,
              type: 'transfer' as const,
            },
          },
        ],
        providerName: 'thetascan',
        cursor: {
          primary: { type: 'blockNumber' as const, value: 123 },
          lastTransactionId: '0xtheta1',
          totalFetched: 1,
          metadata: { providerName: 'thetascan', updatedAt: Date.now(), isComplete: true },
        },
        isComplete: true,
        stats: { fetched: 1, deduplicated: 0, yielded: 1 },
      });
    });

    const importer = createImporter();
    const result = await consumeImportStream(importer, {
      platformKey: 'theta',
      platformKind: 'blockchain',
      address: TEST_ADDRESS,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.rawTransactions).toHaveLength(1);
    expect(result.value.rawTransactions[0]).toMatchObject({
      providerName: 'thetascan',
      sourceAddress: TEST_ADDRESS,
      blockchainTransactionHash: '0xtheta1',
      transactionTypeHint: 'normal',
    });
    expect(mockProviderManager.streamAddressTransactions).toHaveBeenCalledTimes(1);
    expect(mockProviderManager.streamAddressTransactions).toHaveBeenCalledWith(
      'theta',
      TEST_ADDRESS,
      { preferredProvider: undefined, streamType: 'normal' },
      undefined
    );
  });

  test('preserves normalized token hints when THETA arrives on the normal stream', async () => {
    mockProviderManager.streamAddressTransactions.mockImplementationOnce(async function* () {
      yield ok({
        data: [
          {
            raw: { hash: '0xtheta2' },
            normalized: {
              eventId: 'b'.repeat(64),
              id: '0xtheta2',
              timestamp: 1700000000001,
              type: 'token_transfer' as const,
            },
          },
        ],
        providerName: 'theta-explorer',
        cursor: {
          primary: { type: 'blockNumber' as const, value: 456 },
          lastTransactionId: '0xtheta2',
          totalFetched: 1,
          metadata: { providerName: 'theta-explorer', updatedAt: Date.now(), isComplete: true },
        },
        isComplete: true,
        stats: { fetched: 1, deduplicated: 0, yielded: 1 },
      });
    });

    const importer = createImporter();
    const result = await consumeImportStream(importer, {
      platformKey: 'theta',
      platformKind: 'blockchain',
      address: TEST_ADDRESS,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.rawTransactions[0]?.transactionTypeHint).toBe('token');
  });
});
