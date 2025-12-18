import type {
  BlockchainProviderManager,
  CardanoTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { generateUniqueTransactionEventId } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ImportParams, IImporter, ImportBatchResult } from '../../../shared/types/importers.js';

/**
 * Cardano transaction importer that fetches raw transaction data from blockchain APIs.
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class CardanoTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('cardanoImporter');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Cardano importer');
    }

    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig('cardano', options?.preferredProvider);

    this.logger.info(
      `Initialized Cardano transaction importer - ProvidersCount: ${this.providerManager.getProviders('cardano').length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Cardano transaction import'));
      return;
    }

    this.logger.info(`Starting Cardano streaming import for address: ${params.address.substring(0, 20)}...`);

    // Stream transactions for the address
    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.info(`Cardano streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<CardanoTransaction>>(
      'cardano',
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: (params) =>
          `cardano:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:all`,
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

      // Map to raw transactions
      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        eventId: generateUniqueTransactionEventId({
          amount: txWithRaw.normalized.outputs[0]?.amounts[0]?.quantity || '0',
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.inputs[0]?.address || '',
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.outputs[0]?.address,
          type: 'transfer',
        }),
        blockchainTransactionHash: txWithRaw.normalized.id,
        normalizedData: txWithRaw.normalized,
        providerName: providerBatch.providerName,
        providerData: txWithRaw.raw,
        sourceAddress: address,
      }));

      yield ok({
        rawTransactions: rawTransactions,
        operationType: 'normal',
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }
}
