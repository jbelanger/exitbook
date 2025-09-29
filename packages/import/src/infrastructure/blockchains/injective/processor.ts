import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { createMoney } from '@crypto/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import type { ITransactionRepository } from '../../../app/ports/transaction-repository.ts';

// Import processors to trigger registration
import './register-mappers.ts';
import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import { TransactionMapperFactory } from '../../shared/processors/processor-registry.ts';

import type { InjectiveTransaction, InjectiveFundFlow } from './types.ts';

/**
 * Injective transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Enhanced with sophisticated fund flow analysis.
 */
export class InjectiveTransactionProcessor extends BaseProcessor {
  constructor(private transactionRepository?: ITransactionRepository) {
    super('injective');
  }

  /**
   * Process normalized InjectiveTransaction data with sophisticated fund flow analysis
   */
  protected async processNormalizedInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata?.address) {
      return err('No address provided in session metadata');
    }

    const universalTransactions: UniversalTransaction[] = [];

    for (const transaction of normalizedData) {
      const normalizedTx = transaction as InjectiveTransaction;
      try {
        // Analyze fund flow for sophisticated transaction classification
        const fundFlow = this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata.address);

        // Determine transaction type based on fund flow analysis
        const transactionType = this.determineTransactionTypeFromFundFlow(fundFlow);

        // Convert to UniversalTransaction with enhanced metadata
        const universalTransaction: UniversalTransaction = {
          amount: createMoney(fundFlow.totalAmount, fundFlow.currency),
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          fee: fundFlow.feeAmount ? createMoney(fundFlow.feeAmount, 'INJ') : createMoney('0', 'INJ'),
          from: fundFlow.fromAddress,
          id: normalizedTx.id,
          metadata: {
            blockchain: 'injective',
            blockHeight: normalizedTx.blockHeight,
            blockId: normalizedTx.blockId,
            bridgeType: normalizedTx.bridgeType,
            ethereumReceiver: normalizedTx.ethereumReceiver,
            ethereumSender: normalizedTx.ethereumSender,
            eventNonce: normalizedTx.eventNonce,
            fundFlow: {
              feePaidByUser: fundFlow.feePaidByUser,
              isIncoming: fundFlow.isIncoming,
              isOutgoing: fundFlow.isOutgoing,
              netAmount: fundFlow.netAmount,
              transactionType: fundFlow.transactionType,
            },
            messageType: normalizedTx.messageType,
            providerId: normalizedTx.providerId,
            sourceChannel: normalizedTx.sourceChannel,
            sourcePort: normalizedTx.sourcePort,
            tokenAddress: normalizedTx.tokenAddress,
            tokenType: normalizedTx.tokenType,
          },
          source: 'injective',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          symbol: fundFlow.currency,
          timestamp: normalizedTx.timestamp,
          to: fundFlow.toAddress,
          type: transactionType,
        };

        universalTransactions.push(universalTransaction);
      } catch (error) {
        this.logger.warn(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    return Promise.resolve(ok(universalTransactions));
  }

  /**
   * Check if this processor can handle the specified source type.
   */
  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'blockchain';
  }

  protected async processInternal(
    rawDataItems: StoredRawData[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return Promise.resolve(err(`No session metadata provided`));
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

    return Promise.resolve(ok(Array.from(transactionMap.values())));
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

    // Injective processors return array with single transaction
    const blockchainTransaction = blockchainTransactions;

    if (!blockchainTransaction) {
      return err(`No valid blockchain transaction found for ${rawDataItem.metadata.providerId}`);
    }

    // Determine proper transaction type based on Injective transaction flow
    const transactionType = this.mapTransactionType(blockchainTransaction, sessionContext);

    // Convert UniversalBlockchainTransaction to UniversalTransaction
    const universalTransaction: UniversalTransaction = {
      amount: createMoney(blockchainTransaction.amount, blockchainTransaction.currency),
      datetime: new Date(blockchainTransaction.timestamp).toISOString(),
      fee: blockchainTransaction.feeAmount
        ? createMoney(blockchainTransaction.feeAmount, blockchainTransaction.feeCurrency || 'INJ')
        : createMoney('0', 'INJ'),
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

    this.logger.debug(
      `Successfully processed transaction ${universalTransaction.id} from ${rawDataItem.metadata.providerId}`
    );
    return ok(universalTransaction);
  }

  /**
   * Analyze fund flow from normalized InjectiveTransaction data
   */
  private analyzeFundFlowFromNormalized(transaction: InjectiveTransaction, userAddress: string): InjectiveFundFlow {
    const userAddressLower = userAddress.toLowerCase();
    const fromAddressLower = transaction.from.toLowerCase();
    const toAddressLower = transaction.to.toLowerCase();

    // Determine flow direction
    const isIncoming = toAddressLower === userAddressLower;
    const isOutgoing = fromAddressLower === userAddressLower;

    // Calculate amounts
    const totalAmount = transaction.amount;
    let netAmount = totalAmount;

    // For outgoing transactions, net amount is negative
    if (isOutgoing && !isIncoming) {
      netAmount = `-${totalAmount}`;
    }

    // For internal transfers (self-sends), net amount is 0
    if (isIncoming && isOutgoing) {
      netAmount = '0';
    }

    // Determine transaction classification
    let transactionType: InjectiveFundFlow['transactionType'] = 'internal_transfer';

    if (transaction.bridgeType === 'peggy') {
      transactionType = isIncoming ? 'bridge' : 'bridge';
    } else if (transaction.bridgeType === 'ibc') {
      transactionType = 'ibc';
    } else if (isIncoming && !isOutgoing) {
      transactionType = 'deposit';
    } else if (isOutgoing && !isIncoming) {
      transactionType = 'withdrawal';
    }

    // Fee analysis
    const feePaidByUser = isOutgoing; // User pays fees when sending transactions
    const feeAmount = feePaidByUser ? transaction.feeAmount : undefined;

    return {
      bridgeType: transaction.bridgeType,
      currency: transaction.currency,
      destinationChain: transaction.sourceChannel ? 'injective' : undefined,
      feeAmount,
      feePaidByUser,
      fromAddress: transaction.from,
      isIncoming,
      isOutgoing,
      netAmount,
      sourceChain: transaction.sourceChannel ? 'ibc' : undefined,
      toAddress: transaction.to,
      tokenAddress: transaction.tokenAddress,
      tokenDecimals: transaction.tokenDecimals,
      totalAmount,
      transactionType,
    };
  }

  /**
   * Determine UniversalTransaction type based on fund flow analysis
   */
  private determineTransactionTypeFromFundFlow(fundFlow: InjectiveFundFlow): UniversalTransaction['type'] {
    // Bridge transactions
    if (fundFlow.bridgeType === 'peggy') {
      return fundFlow.isIncoming ? 'deposit' : 'withdrawal';
    }

    // IBC transfers
    if (fundFlow.bridgeType === 'ibc') {
      return fundFlow.isIncoming ? 'deposit' : 'withdrawal';
    }

    // Internal transfers (self-sends)
    if (fundFlow.isIncoming && fundFlow.isOutgoing) {
      return 'fee';
    }

    // Regular transfers
    if (fundFlow.isIncoming) {
      return 'deposit';
    }

    if (fundFlow.isOutgoing) {
      return 'withdrawal';
    }

    // Fallback to transfer for any unhandled cases
    return 'transfer';
  }
}
