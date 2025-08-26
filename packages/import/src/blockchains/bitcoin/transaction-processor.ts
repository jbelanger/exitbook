import type { UniversalTransaction } from '@crypto/core';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/MempoolSpaceProcessor.ts';
import type { BitcoinTransaction } from './types.ts';

/**
 * Bitcoin transaction processor that converts sourced raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class BitcoinTransactionProcessor extends BaseProcessor<ApiClientRawData<BitcoinTransaction>> {
  constructor(_dependencies: IDependencyContainer) {
    super('bitcoin');
  }

  /**
   * Check if this processor can handle the specified adapter type.
   */
  protected canProcessAdapterType(adapterType: string): boolean {
    return adapterType === 'blockchain';
  }

  /**
   * Process a single sourced raw transaction using provider-specific processors.
   */
  async processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<BitcoinTransaction>>
  ): Promise<UniversalTransaction | null> {
    try {
      const apiClientRawData = rawDataItem.rawData;
      const { providerId, rawData } = apiClientRawData;

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
