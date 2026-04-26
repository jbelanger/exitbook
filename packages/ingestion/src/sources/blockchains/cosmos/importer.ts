import { type IBlockchainProviderRuntime, type TransactionWithRawData } from '@exitbook/blockchain-providers';
import { type CosmosChainConfig, type CosmosTransaction } from '@exitbook/blockchain-providers/cosmos';
import type { CursorState } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';

import type { IImporter, StreamingImportParams, ImportBatchResult } from '../../../shared/types/importers.js';
import { mapToRawTransactions } from '../shared/importer-utils.js';

/**
 * Generic Cosmos SDK transaction importer that fetches raw transaction data from blockchain APIs.
 * Registered only for Cosmos SDK chains with verified account-history support.
 * Uses provider runtime for failover between multiple API providers per chain.
 */
export class CosmosImporter implements IImporter {
  private readonly logger: Logger;
  private readonly preferredProvider?: string | undefined;
  private providerRuntime: IBlockchainProviderRuntime;
  private chainConfig: CosmosChainConfig;

  constructor(
    chainConfig: CosmosChainConfig,
    blockchainProviderManager: IBlockchainProviderRuntime,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`cosmosImporter:${chainConfig.chainName}`);

    this.providerRuntime = blockchainProviderManager;
    this.preferredProvider = options?.preferredProvider;

    this.logger.info(
      `Initialized ${chainConfig.displayName} transaction importer - ProvidersCount: ${this.providerRuntime.getProviders(chainConfig.chainName, { preferredProvider: this.preferredProvider }).length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: StreamingImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address?.length) {
      yield err(new Error(`Address required for ${this.chainConfig.displayName} transaction import`));
      return;
    }

    this.logger.info(
      `Starting ${this.chainConfig.displayName} streaming import for address: ${params.address.substring(0, 20)}...`
    );

    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.info(`${this.chainConfig.displayName} streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider runtime's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerRuntime.streamAddressTransactions<TransactionWithRawData<CosmosTransaction>>(
      this.chainConfig.chainName,
      address,
      { preferredProvider: this.preferredProvider },
      resumeCursor
    );

    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      const transactionsWithRaw = providerBatch.data;

      // Log batch stats including in-memory deduplication
      if (providerBatch.stats.deduplicated > 0) {
        this.logger.info(
          `Provider batch stats: ${providerBatch.stats.fetched} fetched, ${providerBatch.stats.deduplicated} deduplicated by provider, ${providerBatch.stats.yielded} yielded`
        );
      }

      const rawTransactions = mapToRawTransactions(transactionsWithRaw, providerBatch.providerName, address);

      yield ok({
        rawTransactions,
        streamType: 'normal',
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
        providerStats: {
          fetched: providerBatch.stats.fetched,
          deduplicated: providerBatch.stats.deduplicated,
        },
      });
    }
  }
}
