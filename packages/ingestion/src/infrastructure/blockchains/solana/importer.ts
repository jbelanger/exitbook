import type {
  BlockchainProviderManager,
  SolanaTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../types/importers.js';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class SolanaTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('solanaImporter');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Solana importer');
    }

    this.providerManager.autoRegisterFromConfig('solana', options?.preferredProvider);

    this.logger.info(
      `Initialized Solana transaction importer - ProvidersCount: ${this.providerManager.getProviders('solana').length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Solana transaction import'));
      return;
    }

    this.logger.info(`Starting Solana streaming import for address: ${params.address.substring(0, 20)}...`);

    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.info(`Solana streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<SolanaTransaction>>(
      'solana',
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: (params) =>
          `solana:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:all`,
      },
      resumeCursor
    );

    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      const transactionsWithRaw = providerBatch.data;

      // Map to external transactions
      const externalTransactions = transactionsWithRaw.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.amount,
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.from,
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.to,
          tokenAddress: txWithRaw.normalized.tokenAddress,
          traceId: txWithRaw.normalized.signature,
          type: 'transfer',
        }),
        blockchainTransactionHash: txWithRaw.normalized.id,
        normalizedData: txWithRaw.normalized,
        providerName: providerBatch.providerName,
        rawData: txWithRaw.raw,
        sourceAddress: address,
      }));

      yield ok({
        rawTransactions: externalTransactions,
        operationType: 'normal',
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }
}
