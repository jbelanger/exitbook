import { type Result, err, ok } from 'neverthrow';

import { createMoney } from '../../decimal-utils.js';
import { BaseProcessor } from '../../shared/processors/base-processor.js';
import type {
  ApiClientRawData,
  ImportSessionMetadata,
} from '../../shared/processors/interfaces.js';

// Import processors to trigger registration
import './mappers/index.js';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.js';
import type { StoredRawData, UniversalTransaction, TransactionType } from '../../types.js';

import type { EthereumRawTransactionData } from './transaction-importer.js';

/**
 * Ethereum transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class EthereumTransactionProcessor extends BaseProcessor<
  ApiClientRawData<EthereumRawTransactionData>
> {
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
    rawDataItems: StoredRawData<ApiClientRawData<EthereumRawTransactionData>>[],
    sessionMetadata?: ImportSessionMetadata,
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
    rawDataItem: StoredRawData<ApiClientRawData<EthereumRawTransactionData>>,
    sessionContext: ImportSessionMetadata,
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

    // Ethereum processors return array with single transaction
    const blockchainTransaction = blockchainTransactions[0];

    // Debug logging to understand what type we're getting
    if (!blockchainTransaction) {
      return err(`Transaction object is undefined for ${providerId}`);
    }
    this.logger.debug(
      `Processing transaction ${blockchainTransaction.id} with type: ${blockchainTransaction.type}, currency: ${blockchainTransaction.currency}, tokenSymbol: ${blockchainTransaction.tokenSymbol}`,
    );

    // Determine proper transaction type based on Ethereum transaction flow
    // Use BaseProcessor logic for both token transfers and ETH transfers to properly classify
    // deposits, withdrawals, and internal transfers based on address ownership
    const transactionType: TransactionType = this.mapTransactionType(
      blockchainTransaction,
      sessionContext,
    );

    this.logger.debug(
      `Transaction ${blockchainTransaction.id} (${blockchainTransaction.type}) classified as: ${transactionType}`,
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
      `Successfully processed transaction ${universalTransaction.id} from ${providerId}`,
    );
    return ok(universalTransaction);
  }
}
