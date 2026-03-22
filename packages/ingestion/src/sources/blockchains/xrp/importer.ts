import { type IBlockchainProviderRuntime, type TransactionWithRawData } from '@exitbook/blockchain-providers';
import { type XrpChainConfig, type XrpTransaction } from '@exitbook/blockchain-providers/xrp';
import type { CursorState } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';

import type { ImportBatchResult, StreamingImportParams, IImporter } from '../../../shared/types/importers.js';
import { mapToRawTransactions } from '../shared/importer-utils.js';

/**
 * XRP transaction importer that fetches raw transaction data from XRPL RPC APIs.
 * Uses provider manager for failover between multiple XRPL RPC providers.
 */
export class XrpImporter implements IImporter {
  private readonly chainConfig: XrpChainConfig;
  private readonly logger: Logger;
  private readonly preferredProvider?: string | undefined;
  private providerManager: IBlockchainProviderRuntime;

  constructor(
    chainConfig: XrpChainConfig,
    blockchainProviderManager: IBlockchainProviderRuntime,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`${this.chainConfig.chainName}Importer`);
    this.providerManager = blockchainProviderManager;
    this.preferredProvider = options?.preferredProvider;

    this.logger.info(
      `Initialized XRP transaction importer - ProvidersCount: ${this.providerManager.getProviders(this.chainConfig.chainName, { preferredProvider: this.preferredProvider }).length}`
    );
  }

  async *importStreaming(params: StreamingImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for XRP transaction import'));
      return;
    }

    this.logger.debug(`Starting XRP streaming import for address: ${params.address.substring(0, 20)}...`);

    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.debug(`XRP streaming import completed`);
  }

  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.streamAddressTransactions<TransactionWithRawData<XrpTransaction>>(
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
