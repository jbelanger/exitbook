import type { ExternalTransaction } from '@exitbook/core';
import type {
  BlockchainProviderManager,
  CardanoTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/providers';
import { generateUniqueTransactionId } from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

import type { ImportParams, IImporter, ImportRunResult } from '../../../types/importers.js';

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
   * Import raw transaction data from Cardano blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Cardano transaction import'));
    }

    this.logger.info(`Starting Cardano transaction import for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address);

    return result
      .map((externalTransactions) => {
        this.logger.info(`Cardano import completed: ${externalTransactions.length} transactions`);
        return {
          metadata: undefined,
          rawTransactions: externalTransactions,
        };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('cardano', {
      address: address,
      getCacheKey: (params) =>
        `cardano:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<CardanoTransaction>[];
      const providerName = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.outputs[0]?.amounts[0]?.quantity || '0',
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.inputs[0]?.address || '',
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.outputs[0]?.address,
          type: 'transfer',
        }),
        normalizedData: txWithRaw.normalized,
        providerName,
        rawData: txWithRaw.raw,
        sourceAddress: address,
      }));
    });
  }
}
