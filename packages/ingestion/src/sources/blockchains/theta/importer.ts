import { type IBlockchainProviderManager, type TransactionWithRawData } from '@exitbook/blockchain-providers';
import { type ThetaChainConfig } from '@exitbook/blockchain-providers/theta';
import type { CursorState } from '@exitbook/core';
import { getErrorMessage, wrapError } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';

import type { IImporter, ImportBatchResult, StreamingImportParams } from '../../../shared/types/importers.js';
import { mapToRawTransactions } from '../evm/evm-importer-utils.js';

import type { ThetaTransaction } from './types.js';

export class ThetaImporter implements IImporter {
  private readonly logger: Logger;
  private readonly transactionTypes: string[];

  constructor(
    private readonly chainConfig: ThetaChainConfig,
    private readonly providerManager: IBlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger(`thetaImporter:${chainConfig.chainName}`);

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);
    this.transactionTypes = chainConfig.transactionTypes;

    this.logger.info(
      `Initialized ${chainConfig.chainName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  async *importStreaming(params: StreamingImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
      return;
    }

    const address = params.address;
    const resumeNote = params.cursor ? ' (resuming from cursor)' : '';

    this.logger.info(
      `Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}...${resumeNote}`
    );

    try {
      for (const streamType of this.transactionTypes) {
        const resumeCursor = params.cursor?.[streamType];

        if (!this.hasProviderSupport(streamType)) {
          this.logger.warn(`Skipping ${streamType} transactions (no provider support)`);
          continue;
        }

        for await (const batchResult of this.streamTransactionType(address, streamType, resumeCursor)) {
          yield batchResult;
        }
      }

      this.logger.info(`${this.chainConfig.chainName} streaming import completed`);
    } catch (error) {
      this.logger.error(`Failed to stream transactions for address ${address}: ${getErrorMessage(error)}`);
      yield wrapError(error, `Failed to stream ${this.chainConfig.chainName} transactions for ${address}`);
    }
  }

  private async *streamTransactionType(
    address: string,
    streamType: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.streamAddressTransactions<TransactionWithRawData<ThetaTransaction>>(
      this.chainConfig.chainName,
      address,
      { streamType },
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
      } else {
        this.logger.debug(`Theta importer received ${transactionsWithRaw.length} transactions from provider batch`);
      }

      const rawTransactions = mapToRawTransactions(transactionsWithRaw, providerBatch.providerName, address);

      yield ok({
        rawTransactions,
        streamType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
        providerStats: {
          fetched: providerBatch.stats.fetched,
          deduplicated: providerBatch.stats.deduplicated,
        },
      });
    }
  }

  private hasProviderSupport(streamType: string): boolean {
    const providers = this.providerManager.getProviders(this.chainConfig.chainName);
    return providers.some((provider) => {
      if (!provider.capabilities.supportedOperations.includes('getAddressTransactions')) {
        return false;
      }

      const supportedTypes = provider.capabilities.supportedTransactionTypes;
      if (!supportedTypes) {
        return streamType === 'normal';
      }

      return supportedTypes.includes(streamType);
    });
  }
}
