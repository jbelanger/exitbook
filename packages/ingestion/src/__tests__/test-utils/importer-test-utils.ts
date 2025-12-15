import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { PaginationCursor } from '@exitbook/core';
import type { CursorState, RawTransactionInput } from '@exitbook/core';
import { err, errAsync, ok, type Result } from 'neverthrow';
import { expect, vi, type Mocked } from 'vitest';

import type { IImporter, ImportParams } from '../../types/importers.js';

export interface ImportRunResult {
  rawTransactions: RawTransactionInput[];
  cursorUpdates: Record<string, CursorState>;
}

export async function consumeImportStream(
  importer: IImporter,
  params: ImportParams
): Promise<Result<ImportRunResult, Error>> {
  const allTransactions: RawTransactionInput[] = [];
  const cursorUpdates: Record<string, CursorState> = {};

  for await (const batchResult of importer.importStreaming(params)) {
    if (batchResult.isErr()) {
      return err(batchResult.error);
    }

    const batch = batchResult.value;
    allTransactions.push(...batch.rawTransactions);
    cursorUpdates[batch.operationType] = batch.cursor;
  }

  return ok({
    rawTransactions: allTransactions,
    cursorUpdates,
  });
}

/**
 * Helper to assert that a Result is Ok and return its value.
 * If the result is Err, this fails the test with the error message.
 */
export function assertOk<T, E extends Error>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw new Error(`Expected Ok, got Err: ${result.error.message}`);
  }
  expect(result.isOk()).toBe(true);
  return result.value;
}

export type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

/**
 * Creates a mock BlockchainProviderManager with default mocks.
 */
export function createMockProviderManager(blockchain: string): ProviderManagerMock {
  const mockProviderManager = {
    autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
    executeWithFailover: vi.fn<BlockchainProviderManager['executeWithFailover']>(),
    getProviders: vi.fn<BlockchainProviderManager['getProviders']>(),
  } as unknown as ProviderManagerMock;

  mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);
  mockProviderManager.getProviders.mockReturnValue([
    {
      name: 'mock-provider',
      blockchain,
      benchmarkRateLimit: vi.fn().mockResolvedValue({
        maxSafeRate: 1,
        recommended: { maxRequestsPerSecond: 1 },
        testResults: [],
      }),
      capabilities: { supportedOperations: [] },
      execute: vi.fn(),
      isHealthy: vi.fn().mockResolvedValue(true),
      rateLimit: { requestsPerSecond: 1 },
      executeStreaming: vi.fn(async function* () {
        yield errAsync(new Error('Streaming not implemented in mock'));
      }),
      extractCursors: vi.fn((_transaction: unknown): PaginationCursor[] => []),
      applyReplayWindow: vi.fn((cursor: PaginationCursor): PaginationCursor => cursor),
    },
  ]);

  return mockProviderManager;
}
