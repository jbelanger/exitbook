import { type IBlockchainProviderRuntime, type TransactionWithRawData } from '@exitbook/blockchain-providers';
import { type BitcoinChainConfig, type BitcoinTransaction } from '@exitbook/blockchain-providers/bitcoin';
import type { CursorState } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';

import type { StreamingImportParams, IImporter, ImportBatchResult } from '../../../shared/types/importers.js';
import { mapToRawTransactions } from '../shared/importer-utils.js';

/**
 * Bitcoin transaction importer that fetches raw transaction data from blockchain APIs.
 * Uses provider runtime for failover between multiple blockchain API providers.
 */
export class BitcoinImporter implements IImporter {
  private readonly chainConfig: BitcoinChainConfig;
  private readonly logger: Logger;
  private readonly preferredProvider?: string | undefined;
  private providerRuntime: IBlockchainProviderRuntime;

  constructor(
    chainConfig: BitcoinChainConfig,
    blockchainProviderManager: IBlockchainProviderRuntime,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`${this.chainConfig.chainName}Importer`);
    this.providerRuntime = blockchainProviderManager;
    this.preferredProvider = options?.preferredProvider;

    this.logger.info(
      `Initialized Bitcoin transaction importer - ProvidersCount: ${this.providerRuntime.getProviders(this.chainConfig.chainName, { preferredProvider: this.preferredProvider }).length}`
    );
  }

  async *importStreaming(params: StreamingImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for Bitcoin transaction import'));
      return;
    }

    this.logger.debug(`Starting Bitcoin streaming import for address: ${params.address.substring(0, 20)}...`);

    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.info(`Bitcoin streaming import completed`);
  }

  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerRuntime.streamAddressTransactions<TransactionWithRawData<BitcoinTransaction>>(
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
