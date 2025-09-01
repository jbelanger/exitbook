import type { UniversalTransaction } from '@crypto/core';
// Import processors to trigger registration
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { ApiClientRawData, ImportSessionMetadata } from '../../shared/processors/interfaces.ts';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.ts';
// Import processors to trigger registration
import './mappers/index.ts';
import type { InjectiveTransaction } from './types.ts';

/**
 * Injective transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class InjectiveTransactionProcessor extends BaseProcessor<ApiClientRawData<InjectiveTransaction>> {
  constructor() {
    super('injective');
  }

  private processSingle(
    rawDataItem: StoredRawData<ApiClientRawData<InjectiveTransaction>>,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction | null, string> {
    const apiClientRawData = rawDataItem.rawData;
    const { providerId, rawData } = apiClientRawData;

    // Get the appropriate processor for this provider
    const processor = TransactionMapperFactory.create(providerId);
    if (!processor) {
      return err(`No processor found for provider: ${providerId}`);
    }

    // Transform using the provider-specific processor
    const transformResult = processor.map(rawData, sessionContext);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const blockchainTransactions = transformResult.value;
    if (blockchainTransactions.length === 0) {
      return err(`No transactions returned from ${providerId} processor`);
    }

    // Injective processors return array with single transaction
    const blockchainTransaction = blockchainTransactions[0];

    // Determine proper transaction type based on Injective transaction flow
    const transactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'INJ')
        : createMoney(0, 'INJ'),
      from: blockchainTransaction.from,
      id: blockchainTransaction.id,
      metadata: {
        blockchain: 'injective',
        blockHeight: blockchainTransaction.blockHeight,
        blockId: blockchainTransaction.blockId,
        providerId: blockchainTransaction.providerId,
      },
      source: 'injective',
      status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
      symbol: blockchainTransaction.currency,
      timestamp: blockchainTransaction.timestamp,
      to: blockchainTransaction.to,
      type: transactionType,
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
    rawDataItems: StoredRawData<ApiClientRawData<InjectiveTransaction>>[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err(`No session metadata provided`);
    }

    // Group raw data items by transaction ID to handle duplicates
    const transactionMap = new Map<string, UniversalTransaction>();

    for (const item of rawDataItems) {
      const result = this.processSingle(item, sessionMetadata);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction ${item.id}: ${result.error}`);
        continue;
      }

      const transaction = result.value;
      if (transaction) {
        // Use transaction ID as key to deduplicate
        transactionMap.set(transaction.id, transaction);
      }
    }

    return ok(Array.from(transactionMap.values()));
  }
}
