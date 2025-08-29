import type { UniversalTransaction } from '@crypto/core';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './processors/SubstrateProcessor.ts';
import type { SubscanTransfer } from './types.ts';

/**
 * Polkadot transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class PolkadotTransactionProcessor extends BaseProcessor<ApiClientRawData<SubscanTransfer>> {
  constructor(_dependencies: IDependencyContainer) {
    super('polkadot');
  }

  private processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<SubscanTransfer>>
  ): Result<UniversalTransaction | null, string> {
    const apiClientRawData = rawDataItem.rawData;
    const { providerId, rawData } = apiClientRawData;

    // Get the appropriate processor for this provider
    const processor = ProcessorFactory.create(providerId);
    if (!processor) {
      return err(`No processor found for provider: ${providerId}`);
    }

    // Validate the raw data
    const validationResult = processor.validate(rawData);
    if (!validationResult.isValid) {
      return err(`Invalid raw data from ${providerId}: ${validationResult.errors?.join(', ')}`);
    }

    // Extract wallet addresses from metadata
    const walletAddresses: string[] = [];
    if (rawDataItem.metadata && typeof rawDataItem.metadata === 'object') {
      const metadata = rawDataItem.metadata as Record<string, unknown>;
      if (metadata.walletAddresses && Array.isArray(metadata.walletAddresses)) {
        walletAddresses.push(...(metadata.walletAddresses as string[]));
      }
    }

    // If no wallet addresses in metadata, we can't determine transaction direction
    if (walletAddresses.length === 0) {
      this.logger.warn(`No wallet addresses found in metadata for transaction ${rawDataItem.sourceTransactionId}`);
      // We can still process the transaction, but with limited context
      walletAddresses.push(''); // Empty address as fallback
    }

    // Transform using the provider-specific processor
    const transformResult = processor.transform(rawData, walletAddresses);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const universalTransaction = transformResult.value;
    this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
    return ok(universalTransaction);
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  protected async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<SubscanTransfer>>[]
  ): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    for (const item of rawDataItems) {
      const result = this.processSingle(item);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction ${item.sourceTransactionId}: ${result.error}`);
        continue; // Continue processing other transactions
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return ok(transactions);
  }
}
