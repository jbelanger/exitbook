import type { UniversalTransaction } from '@crypto/core';
// Import processors to trigger registration
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
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

    // Create session context for Polkadot (uses addresses field from metadata)
    const addresses: string[] = [];
    if (rawDataItem.metadata && typeof rawDataItem.metadata === 'object') {
      const metadata = rawDataItem.metadata as Record<string, unknown>;
      if (metadata.addresses && Array.isArray(metadata.addresses)) {
        addresses.push(...(metadata.addresses as string[]));
      }
    }

    // If no addresses in metadata, we can't determine transaction direction
    if (addresses.length === 0) {
      this.logger.warn(`No addresses found in metadata for transaction ${rawDataItem.sourceTransactionId}`);
      // We can still process the transaction, but with limited context
      addresses.push(''); // Empty address as fallback
    }

    const sessionContext = { addresses };

    // Transform using the provider-specific processor
    const transformResult = processor.transform(rawData, sessionContext);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const blockchainTransaction = transformResult.value;

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'DOT')
        : createMoney(0, 'DOT'),
      from: blockchainTransaction.from,
      id: blockchainTransaction.id,
      metadata: {
        blockchain: 'polkadot',
        blockHeight: blockchainTransaction.blockHeight,
        blockId: blockchainTransaction.blockId,
        providerId: blockchainTransaction.providerId,
      },
      source: 'polkadot',
      status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
      symbol: blockchainTransaction.currency,
      timestamp: blockchainTransaction.timestamp,
      to: blockchainTransaction.to,
      type: 'transfer',
    };

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
