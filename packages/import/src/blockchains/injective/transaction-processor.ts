import type { UniversalTransaction } from '@crypto/core';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import type { IProcessor, SourcedRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/InjectiveExplorerProcessor.ts';
import './processors/InjectiveLCDProcessor.ts';
import type { InjectiveTransaction } from './types.ts';

/**
 * Injective transaction processor that converts sourced raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class InjectiveTransactionProcessor implements IProcessor<SourcedRawData<InjectiveTransaction>> {
  private logger: Logger;

  constructor(dependencies: IDependencyContainer) {
    this.logger = getLogger('InjectiveTransactionProcessor');
  }

  /**
   * Check if this processor can handle data from the specified adapter.
   */
  canProcess(adapterId: string, adapterType: string): boolean {
    return adapterId.toLowerCase() === 'injective' && adapterType === 'blockchain';
  }

  /**
   * Process sourced raw blockchain transaction data into UniversalTransaction format.
   */
  async process(rawDataItems: StoredRawData<SourcedRawData<InjectiveTransaction>>[]): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawDataItems.length} sourced Injective transactions`);

    const universalTransactions: UniversalTransaction[] = [];

    for (const item of rawDataItems) {
      try {
        const transaction = await this.processSingle(item);
        if (transaction) {
          universalTransactions.push(transaction);
        }
      } catch (error) {
        this.logger.error(`Failed to process transaction ${item.sourceTransactionId}: ${error}`);
      }
    }

    this.logger.info(`Successfully processed ${universalTransactions.length} Injective transactions`);
    return universalTransactions;
  }

  /**
   * Process a single sourced raw transaction using provider-specific processors.
   */
  async processSingle(
    rawDataItem: StoredRawData<SourcedRawData<InjectiveTransaction>>
  ): Promise<UniversalTransaction | null> {
    try {
      const sourcedRawData = rawDataItem.rawData;
      const { providerId, rawData } = sourcedRawData;

      // Get the appropriate processor for this provider
      const processor = ProcessorFactory.create(providerId);
      if (!processor) {
        this.logger.error(`No processor found for provider: ${providerId}`);
        return null;
      }

      // Validate the raw data
      const validationResult = processor.validate(rawData);
      if (!validationResult.isValid) {
        this.logger.error(`Invalid raw data from ${providerId}: ${validationResult.errors?.join(', ')}`);
        return null;
      }

      // Extract wallet addresses from raw data (added by importer during fetch)
      const walletAddresses: string[] = [];
      if (rawData.fetchedByAddress) {
        walletAddresses.push(rawData.fetchedByAddress);
      }

      // Transform using the provider-specific processor
      const universalTransaction = processor.transform(rawData, walletAddresses);

      this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
      return universalTransaction;
    } catch (error) {
      this.logger.error(`Failed to process single transaction ${rawDataItem.sourceTransactionId}: ${error}`);
      return null;
    }
  }
}
