import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney } from '@exitbook/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { InjectiveTransaction, InjectiveFundFlow } from './types.js';

/**
 * Injective transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Enhanced with sophisticated fund flow analysis.
 */
export class InjectiveTransactionProcessor extends BaseTransactionProcessor {
  constructor(private _transactionRepository?: ITransactionRepository) {
    super('injective');
  }

  /**
   * Process normalized InjectiveTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
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

        const networkFee = fundFlow.feeAmount ? createMoney(fundFlow.feeAmount, 'INJ') : createMoney('0', 'INJ');

        // Convert to UniversalTransaction with enhanced metadata
        const universalTransaction: UniversalTransaction = {
          // Core fields
          id: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'injective',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            outflows: fundFlow.isOutgoing
              ? [
                  {
                    amount: createMoney(fundFlow.totalAmount, fundFlow.currency),
                    asset: fundFlow.currency,
                  },
                ]
              : [],
            inflows: fundFlow.isIncoming
              ? [
                  {
                    amount: createMoney(fundFlow.totalAmount, fundFlow.currency),
                    asset: fundFlow.currency,
                  },
                ]
              : [],
            primary: {
              amount: createMoney(fundFlow.netAmount, fundFlow.currency),
              asset: fundFlow.currency,
              direction: fundFlow.isIncoming ? 'in' : fundFlow.isOutgoing ? 'out' : 'neutral',
            },
          },

          // Structured fees
          fees: {
            network: networkFee,
            platform: undefined, // Injective has no platform fees
            total: networkFee,
          },

          // Enhanced classification
          operation: {
            category: fundFlow.isIncoming && fundFlow.isOutgoing ? 'fee' : 'transfer',
            type:
              fundFlow.isIncoming && fundFlow.isOutgoing
                ? 'fee'
                : fundFlow.isIncoming
                  ? 'deposit'
                  : fundFlow.isOutgoing
                    ? 'withdrawal'
                    : 'transfer',
          },

          // Blockchain metadata
          blockchain: {
            name: 'injective',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Minimal metadata - only Injective-specific data
          metadata: {
            providerId: normalizedTx.providerId,
            blockId: normalizedTx.blockId,
            bridgeType: normalizedTx.bridgeType,
            messageType: normalizedTx.messageType,
            ethereumSender: normalizedTx.ethereumSender,
            ethereumReceiver: normalizedTx.ethereumReceiver,
            eventNonce: normalizedTx.eventNonce,
            sourceChannel: normalizedTx.sourceChannel,
            sourcePort: normalizedTx.sourcePort,
            tokenAddress: normalizedTx.tokenAddress,
            tokenType: normalizedTx.tokenType,
          },

          // Backward compatibility (deprecated)
          amount: createMoney(fundFlow.totalAmount, fundFlow.currency),
          fee: networkFee,
          type: transactionType,
          symbol: fundFlow.currency,
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
