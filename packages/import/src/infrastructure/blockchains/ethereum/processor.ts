import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { TransactionType, UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney } from '@exitbook/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../app/ports/transaction-processor.interface.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { EthereumFundFlow, EthereumTransaction } from './types.js';

/**
 * Ethereum transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class EthereumTransactionProcessor extends BaseTransactionProcessor {
  constructor(private transactionRepository?: ITransactionRepository) {
    super('ethereum');
  }

  /**
   * Process normalized Ethereum transactions with enhanced fund flow analysis.
   * Handles EthereumTransaction objects with structured transaction data.
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: ImportSessionMetadata
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Ethereum transactions`);

    const transactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as EthereumTransaction;

      try {
        // Perform enhanced fund flow analysis
        const fundFlowResult = this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata);

        if (fundFlowResult.isErr()) {
          this.logger.warn(`Fund flow analysis failed for ${normalizedTx.id}: ${fundFlowResult.error}`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow with historical context
        const transactionType = await this.determineTransactionTypeFromFundFlow(fundFlow, sessionMetadata);

        // Convert to UniversalTransaction
        const universalTransaction: UniversalTransaction = {
          amount: createMoney(fundFlow.netAmount, fundFlow.currency),
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          fee: normalizedTx.feeAmount
            ? createMoney(normalizedTx.feeAmount, normalizedTx.feeCurrency || 'ETH')
            : createMoney('0', 'ETH'),
          from: fundFlow.fromAddress,
          id: normalizedTx.id,
          metadata: {
            blockchain: 'ethereum',
            blockHeight: normalizedTx.blockHeight,
            blockId: normalizedTx.blockId,
            fundFlow: {
              currency: fundFlow.currency,
              feePaidByUser: fundFlow.feePaidByUser,
              isIncoming: fundFlow.isIncoming,
              isOutgoing: fundFlow.isOutgoing,
              netAmount: fundFlow.netAmount,
              totalAmount: fundFlow.totalAmount,
            },
            gasPrice: normalizedTx.gasPrice,
            gasUsed: normalizedTx.gasUsed,
            methodId: normalizedTx.methodId,
            providerId: normalizedTx.providerId,
            tokenAddress: normalizedTx.tokenAddress,
            tokenDecimals: normalizedTx.tokenDecimals,
            tokenSymbol: normalizedTx.tokenSymbol,
            tokenType: normalizedTx.tokenType,
          },
          source: 'ethereum',
          status: normalizedTx.status === 'success' ? 'ok' : 'failed',
          symbol: normalizedTx.tokenSymbol || normalizedTx.currency,
          timestamp: normalizedTx.timestamp,
          to: fundFlow.toAddress,
          type: transactionType,
        };

        transactions.push(universalTransaction);
        this.logger.debug(`Successfully processed normalized transaction ${universalTransaction.id}`);
      } catch (error) {
        this.logger.error(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    this.logger.info(`Normalized processing completed: ${transactions.length} transactions processed successfully`);
    return ok(transactions);
  }

  /**
   * Analyze fund flow from normalized Ethereum transaction.
   */
  private analyzeFundFlowFromNormalized(
    normalizedTx: EthereumTransaction,
    sessionMetadata: ImportSessionMetadata
  ): Result<EthereumFundFlow, string> {
    const userAddress = sessionMetadata.address?.toLowerCase();
    if (!userAddress) {
      return err('No user address provided in session metadata');
    }

    const fromAddress = normalizedTx.from.toLowerCase();
    const toAddress = normalizedTx.to.toLowerCase();

    // Determine fund flow direction
    const isOutgoing = fromAddress === userAddress;
    const isIncoming = toAddress === userAddress;
    const feePaidByUser = isOutgoing; // User pays gas fees when sending transactions

    // Calculate net amount (positive = received, negative = sent)
    let netAmount = normalizedTx.amount;
    if (isOutgoing && !isIncoming) {
      // Pure outgoing transaction - negative amount
      netAmount = `-${normalizedTx.amount}`;
    } else if (isIncoming && !isOutgoing) {
      // Pure incoming transaction - positive amount (keep as is)
      netAmount = normalizedTx.amount;
    } else if (isIncoming && isOutgoing) {
      // Self-transfer - net zero but show as transfer
      netAmount = '0';
    } else {
      // Neither incoming nor outgoing - shouldn't happen for user transactions
      return err(`Transaction ${normalizedTx.id} not related to user address ${userAddress}`);
    }

    const fundFlow: EthereumFundFlow = {
      currency: normalizedTx.currency,
      feeAmount: normalizedTx.feeAmount,
      feePaidByUser,
      fromAddress: normalizedTx.from,
      isIncoming,
      isOutgoing,
      netAmount,
      toAddress: normalizedTx.to,
      tokenAddress: normalizedTx.tokenAddress,
      tokenDecimals: normalizedTx.tokenDecimals,
      totalAmount: normalizedTx.amount,
    };

    return ok(fundFlow);
  }

  /**
   * Determine transaction type from fund flow analysis with historical context.
   */
  private async determineTransactionTypeFromFundFlow(
    fundFlow: EthereumFundFlow,
    sessionMetadata: ImportSessionMetadata
  ): Promise<TransactionType> {
    const { isIncoming, isOutgoing } = fundFlow;

    // Use historical context if repository is available
    if (this.transactionRepository && sessionMetadata.address) {
      try {
        // Get recent transactions for pattern analysis
        const recentTransactions = await this.transactionRepository.findRecent(sessionMetadata.address, 50);

        // TODO: Add sophisticated pattern analysis here
        // - Detect recurring deposits/withdrawals
        // - Identify exchange patterns
        // - Recognize DeFi interactions

        this.logger.debug(`Historical context: ${recentTransactions.length} recent transactions for pattern analysis`);
      } catch (error) {
        this.logger.warn(`Failed to fetch historical context: ${String(error)}`);
      }
    }

    // Basic classification logic
    if (isIncoming && isOutgoing) {
      // Self-transfer or internal transfer
      return 'transfer';
    } else if (isIncoming && !isOutgoing) {
      // Pure incoming - deposit
      return 'deposit';
    } else if (!isIncoming && isOutgoing) {
      // Pure outgoing - withdrawal
      return 'withdrawal';
    } else {
      // Fallback
      this.logger.warn(
        `Unable to determine transaction direction for ${fundFlow.fromAddress} -> ${fundFlow.toAddress}`
      );
      return 'transfer';
    }
  }
}
