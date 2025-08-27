import type { UniversalTransaction } from '@crypto/core';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/index.ts';
import type { AvalancheRawTransactionData } from './transaction-importer.ts';

/**
 * Avalanche transaction processor that converts sourced raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class AvalancheTransactionProcessor extends BaseProcessor<ApiClientRawData<AvalancheRawTransactionData>> {
  constructor(_dependencies: IDependencyContainer) {
    super('avalanche');
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Process a single sourced raw transaction using provider-specific processors.
   */
  async processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<AvalancheRawTransactionData>>
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

      // Extract wallet addresses from source address context
      const walletAddresses: string[] = [];
      if (apiClientRawData.sourceAddress) {
        walletAddresses.push(apiClientRawData.sourceAddress);
      }

      // Transform using the provider-specific processor
      const transformResult = processor.transform(rawData, walletAddresses);

      if (!transformResult.success) {
        this.logger.error(`Transform failed for ${providerId}: ${transformResult.error}`);
        return null;
      }

      const universalTransaction = transformResult.value;
      this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
      return universalTransaction;
    } catch (error) {
      this.logger.error(`Failed to process single transaction ${rawDataItem.sourceTransactionId}: ${error}`);
      return null;
    }
  }
}
