import type { TransactionType, UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ApiClientRawData } from '../../../app/ports/importers.ts';
import type { ImportSessionMetadata } from '../../../app/ports/processors.ts';

// Import processors to trigger registration
import './register-mappers.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.ts';

/**
 * Ethereum transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class EthereumTransactionProcessor extends BaseProcessor {
  constructor() {
    super('ethereum');
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  protected processInternal(
    rawDataItems: StoredRawData[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    if (!sessionMetadata) {
      return Promise.resolve(err('Missing session metadata'));
    }

    for (const item of rawDataItems) {
      const result = this.processSingle(item, sessionMetadata);
      if (result.isErr()) {
        this.logger.warn(`Failed to process transaction ${item.id}: ${result.error}`);
        continue; // Continue processing other transactions
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return Promise.resolve(ok(transactions));
  }

  private processSingle(
    rawDataItem: StoredRawData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalTransaction | undefined, string> {
    // Get the appropriate processor for this provider
    const processor = TransactionMapperFactory.create(rawDataItem.metadata.providerId);
    if (!processor) {
      return err(`No processor found for provider: ${rawDataItem.metadata.providerId}`);
    }

    // Transform using the provider-specific processor
    const transformResult = processor.map(rawDataItem, sessionContext) as Result<
      UniversalBlockchainTransaction,
      string
    >;

    if (transformResult.isErr()) {
      return err(`Transform failed for ${rawDataItem.metadata.providerId}: ${transformResult.error}`);
    }

    const blockchainTransactions = transformResult.value;
    if (!blockchainTransactions) {
      return err(`No transactions returned from ${rawDataItem.metadata.providerId} processor`);
    }

    // Ethereum processors return array with single transaction
    const blockchainTransaction = blockchainTransactions;

    // Debug logging to understand what type we're getting
    if (!blockchainTransaction) {
      return err(`Transaction object is undefined for ${rawDataItem.metadata.providerId}`);
    }
    this.logger.debug(
      `Processing transaction ${blockchainTransaction.id} with type: ${blockchainTransaction.type}, currency: ${blockchainTransaction.currency}, tokenSymbol: ${blockchainTransaction.tokenSymbol}`
    );

    // Determine proper transaction type based on Ethereum transaction flow
    // Use BaseProcessor logic for both token transfers and ETH transfers to properly classify
    // deposits, withdrawals, and internal transfers based on address ownership
    const transactionType: TransactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

    this.logger.debug(
      `Transaction ${blockchainTransaction.id} (${blockchainTransaction.type}) classified as: ${transactionType}`
    );

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'ETH')
        : createMoney('0', 'ETH'),
      from: blockchainTransaction.from,
      id: blockchainTransaction.id,
      metadata: {
        blockchain: 'ethereum',
        blockHeight: blockchainTransaction.blockHeight,
        blockId: blockchainTransaction.blockId,
        providerId: blockchainTransaction.providerId,
        tokenAddress: blockchainTransaction.tokenAddress,
        tokenDecimals: blockchainTransaction.tokenDecimals,
        tokenSymbol: blockchainTransaction.tokenSymbol,
      },
      source: 'ethereum',
      status: blockchainTransaction.status === 'success' ? 'ok' : 'failed',
      symbol: blockchainTransaction.tokenSymbol || blockchainTransaction.currency,
      timestamp: blockchainTransaction.timestamp,
      to: blockchainTransaction.to,
      type: transactionType,
    };

    this.logger.debug(
      `Successfully processed transaction ${universalTransaction.id} from ${rawDataItem.metadata.providerId}`
    );
    return ok(universalTransaction);
  }
}
