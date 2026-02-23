import type {
  BlockchainProviderManager,
  TransactionWithRawData,
  XrpChainConfig,
  XrpTransaction,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ImportBatchResult, ImportParams, IImporter } from '../../../shared/types/importers.js';

/**
 * XRP transaction importer that fetches raw transaction data from XRPL RPC APIs.
 * Uses provider manager for failover between multiple XRPL RPC providers.
 */
export class XrpImporter implements IImporter {
  private readonly chainConfig: XrpChainConfig;
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    chainConfig: XrpChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`${this.chainConfig.chainName}Importer`);
    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig(this.chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized XRP transaction importer - ProvidersCount: ${this.providerManager.getProviders(this.chainConfig.chainName).length}`
    );
  }

  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
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
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<XrpTransaction>>(
      this.chainConfig.chainName,
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: () => `${this.chainConfig.chainName}:raw-txs:${address}:all`,
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

      if (providerBatch.stats.deduplicated > 0) {
        this.logger.info(
          `Provider batch stats: ${providerBatch.stats.fetched} fetched, ${providerBatch.stats.deduplicated} deduplicated by provider, ${providerBatch.stats.yielded} yielded`
        );
      }

      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        eventId: txWithRaw.normalized.eventId,
        blockchainTransactionHash: txWithRaw.normalized.id,
        timestamp: txWithRaw.normalized.timestamp,
        normalizedData: txWithRaw.normalized,
        providerName: providerBatch.providerName,
        providerData: txWithRaw.raw,
        sourceAddress: address,
      }));

      yield ok({
        rawTransactions,
        streamType: 'normal',
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
      });
    }
  }
}
