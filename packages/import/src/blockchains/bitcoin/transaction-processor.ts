import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseProcessor } from '../../shared/processors/base-processor.js';
import type { ApiClientRawData, ImportSessionMetadata } from '../../shared/processors/interfaces.js';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.js';

// Import processors to trigger registration
import './mappers/index.js';
import type { BitcoinTransaction } from './types.js';

/**
 * Bitcoin transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Optimized for multi-address processing using session context.
 */
export class BitcoinTransactionProcessor extends BaseProcessor<ApiClientRawData<BitcoinTransaction>> {
  constructor() {
    super('bitcoin');
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  /**
   * Process import session with optimized multi-address session context.
   */
  protected async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<BitcoinTransaction>>[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      throw new Error('Missing session metadata');
    }
    // Create rich session context once for the entire batch
    const sessionContext = this.createSessionContext(sessionMetadata, rawDataItems);

    this.logger.info(
      `Processing Bitcoin session with ${rawDataItems.length} transactions, ` +
        `${sessionContext.derivedAddresses?.length || 0} derived addresses`
    );

    const transactions: UniversalTransaction[] = [];

    // Process all transactions with shared session context
    for (const item of rawDataItems) {
      const typedItem = item;
      const result = this.processSingleWithContext(typedItem, sessionContext);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction ${item.id}: ${result.error}`);
        continue; // Continue processing other transactions
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    this.logger.info(`Bitcoin processing completed: ${transactions.length} transactions processed successfully`);
    return Promise.resolve(ok(transactions));
  }

  /**
   * Extract rich Bitcoin-specific session context from session metadata.
   */
  private createSessionContext(
    sessionMetadata: ImportSessionMetadata,
    rawDataItems: StoredRawData<ApiClientRawData<BitcoinTransaction>>[]
  ): ImportSessionMetadata {
    // Extract derived addresses from session metadata
    const derivedAddresses: string[] = sessionMetadata.derivedAddresses ?? [];

    // Collect source addresses from raw data items
    const sourceAddresses: string[] = [];
    for (const item of rawDataItems) {
      const rawData = item.rawData;
      if (rawData.sourceAddress && !sourceAddresses.includes(rawData.sourceAddress)) {
        sourceAddresses.push(rawData.sourceAddress);
      }
    }

    return {
      address: sessionMetadata.address,
      derivedAddresses,
      ...sessionMetadata,
    };
  }

  /**
   * Process a single transaction with shared session context.
   */
  private processSingleWithContext(
    rawDataItem: StoredRawData<ApiClientRawData<BitcoinTransaction>>,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction | undefined, string> {
    const apiClientRawData = rawDataItem.rawData;
    const { providerId, rawData } = apiClientRawData;

    // Get the appropriate processor for this provider
    const processor = TransactionMapperFactory.create(providerId);
    if (!processor) {
      return err(`No processor found for provider: ${providerId}`);
    }

    // Transform using the provider-specific processor with shared session context
    const transformResult = processor.map(rawData, sessionContext);

    if (transformResult.isErr()) {
      return err(`Transform failed for ${providerId}: ${transformResult.error}`);
    }

    const blockchainTransactions = transformResult.value;
    if (blockchainTransactions.length === 0) {
      return err(`No transactions returned from ${providerId} processor`);
    }

    // Bitcoin processors return array with single transaction
    const blockchainTransaction = blockchainTransactions[0];

    if (!blockchainTransaction) {
      return err(`No valid transaction object returned from ${providerId} processor`);
    }

    // Determine proper transaction type based on Bitcoin transaction flow
    const transactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'BTC')
        : createMoney('0', 'BTC'),
      from: blockchainTransaction.from,
      id: blockchainTransaction.id,
      metadata: {
        blockchain: 'bitcoin',
        blockHeight: blockchainTransaction.blockHeight,
        blockId: blockchainTransaction.blockId,
        providerId: blockchainTransaction.providerId,
      },
      source: 'bitcoin',
      status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
      symbol: blockchainTransaction.currency,
      timestamp: blockchainTransaction.timestamp,
      to: blockchainTransaction.to,
      type: transactionType,
    };

    this.logger.debug(`Successfully processed transaction ${universalTransaction.id} from ${providerId}`);
    return ok(universalTransaction);
  }
}
