import type {
  BlockchainProviderManager,
  SubstrateChainConfig,
  SubstrateTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../shared/types/importers.js';

/**
 * Generic Substrate transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any Substrate-based chain (Polkadot, Kusama, Bittensor, etc.).
 *
 * Uses provider manager for failover between multiple API providers.
 */
export class SubstrateImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;
  private chainConfig: SubstrateChainConfig;

  constructor(
    chainConfig: SubstrateChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`substrateImporter:${chainConfig.chainName}`);

    if (!blockchainProviderManager) {
      throw new Error(`Provider manager required for ${chainConfig.chainName} importer`);
    }

    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.displayName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address?.length) {
      yield err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
      return;
    }

    this.logger.info(
      `Starting ${this.chainConfig.chainName} streaming import for address: ${params.address.substring(0, 20)}...`
    );

    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.info(`${this.chainConfig.chainName} streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<SubstrateTransaction>>(
      this.chainConfig.chainName,
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: (params) =>
          `${this.chainConfig.chainName}:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}_all`,
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
      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        eventId: txWithRaw.normalized.eventId,
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
        isComplete: providerBatch.isComplete,
      });
    }
  }
}
