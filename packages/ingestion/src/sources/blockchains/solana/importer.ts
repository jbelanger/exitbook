import type {
  BlockchainProviderManager,
  SolanaTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../shared/types/importers.js';
import { mapToRawTransactions } from '../shared/importer-utils.js';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class SolanaImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('solanaImporter');

    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig('solana', options?.preferredProvider);

    this.logger.info(
      `Initialized Solana transaction importer - ProvidersCount: ${this.providerManager.getProviders('solana').length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   * Fetches both normal address transactions and token account transactions
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Solana transaction import'));
      return;
    }

    this.logger.info(`Starting Solana streaming import for address: ${params.address.substring(0, 20)}...`);

    // Stream normal address transactions (where address signed)
    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor, 'normal')) {
      yield batchResult;
    }

    // Stream token account transactions (where token accounts received transfers)
    const tokenCursor = params.cursor?.['token'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, tokenCursor, 'token')) {
      yield batchResult;
    }

    this.logger.info(`Solana streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   * Supports both normal address transactions and token account transactions
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor: CursorState | undefined,
    streamType: 'normal' | 'token'
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const operationLabel = streamType === 'normal' ? 'address' : 'token account';

    this.logger.info(`Starting ${operationLabel} transaction stream for address: ${address.substring(0, 20)}...`);

    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<SolanaTransaction>>(
      'solana',
      {
        type: 'getAddressTransactions',
        address,
        streamType: streamType,
        getCacheKey: (params) => {
          if (params.type !== 'getAddressTransactions') return 'unknown';
          const txType = params.streamType || 'default';
          return `solana:raw-txs:${txType}:${params.address}:all`;
        },
      },
      resumeCursor
    );

    let totalFetched = 0;
    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      const transactionsWithRaw = providerBatch.data;

      totalFetched += transactionsWithRaw.length;

      // Log batch stats including in-memory deduplication
      if (providerBatch.stats.deduplicated > 0) {
        this.logger.info(
          `${streamType} batch stats: ${providerBatch.stats.fetched} fetched, ${providerBatch.stats.deduplicated} deduplicated by provider, ${providerBatch.stats.yielded} yielded (total: ${totalFetched})`
        );
      }

      const rawTransactions = mapToRawTransactions(transactionsWithRaw, providerBatch.providerName, address);

      yield ok({
        rawTransactions,
        streamType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
      });
    }

    this.logger.info(
      `Completed ${operationLabel} transaction stream - Total: ${totalFetched} transactions for address: ${address.substring(0, 20)}...`
    );
  }
}
