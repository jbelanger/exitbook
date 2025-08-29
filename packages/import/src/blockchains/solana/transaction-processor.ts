import type { UniversalTransaction } from '@crypto/core';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, StoredRawData } from '../../shared/processors/interfaces.ts';
import { ProcessorFactory } from '../../shared/processors/processor-registry.ts';
import type { SolanaRawTransactionData } from './clients/HeliusApiClient.ts';
// Import processors to trigger registration
import './processors/index.ts';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors (Helius, SolanaRPC, Solscan) based on data provenance.
 */
export class SolanaTransactionProcessor extends BaseProcessor<ApiClientRawData<SolanaRawTransactionData>> {
  constructor(_dependencies: IDependencyContainer) {
    super('solana');
  }

  private processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<SolanaRawTransactionData>>
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

    // Extract wallet addresses from source address context
    const walletAddresses: string[] = [];
    if (apiClientRawData.sourceAddress) {
      walletAddresses.push(apiClientRawData.sourceAddress);
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
    rawDataItems: StoredRawData<ApiClientRawData<SolanaRawTransactionData>>[]
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
