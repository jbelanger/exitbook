import type { SubstrateTransaction, SubstrateChainConfig } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import type { ProcessedTransaction, ProcessingContext } from '../../../types/processors.js';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.js';

import { analyzeFundFlowFromNormalized, determineOperationFromFundFlow, didUserPayFee } from './processor-utils.js';

/**
 * Generic Substrate transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Supports Polkadot, Kusama, Bittensor, and other
 * Substrate-based chains. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class SubstrateProcessor extends BaseTransactionProcessor {
  private chainConfig: SubstrateChainConfig;

  constructor(chainConfig: SubstrateChainConfig) {
    super(chainConfig.chainName);
    this.chainConfig = chainConfig;
  }

  /**
   * Process normalized SubstrateTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SubstrateTransaction;
      try {
        const fundFlowResult = analyzeFundFlowFromNormalized(normalizedTx, context, this.chainConfig);
        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(
            `${errorMsg} for ${this.chainConfig.chainName} transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
          );
          continue;
        }
        const fundFlow = fundFlowResult.value;
        const classification = determineOperationFromFundFlow(fundFlow, normalizedTx);

        // Calculate direction for primary asset
        const hasInflow = fundFlow.inflows.some((i) => i.asset === fundFlow.primary.asset);
        const hasOutflow = fundFlow.outflows.some((o) => o.asset === fundFlow.primary.asset);
        const direction: 'in' | 'out' | 'neutral' =
          hasInflow && hasOutflow ? 'neutral' : hasInflow ? 'in' : hasOutflow ? 'out' : 'neutral';

        // Only include fees if user was the signer/broadcaster (they paid the fee)
        // For incoming transactions (deposits, received transfers), the sender/protocol paid the fee
        const userPaidFee = didUserPayFee(normalizedTx, fundFlow, context.primaryAddress);

        const universalTransaction: ProcessedTransaction = {
          movements: {
            inflows: fundFlow.inflows.map((i) => {
              const amount = parseDecimal(i.amount);
              return {
                asset: i.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
            outflows: fundFlow.outflows.map((o) => {
              const amount = parseDecimal(o.amount);
              return {
                asset: o.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
          },
          fees:
            userPaidFee && !parseDecimal(fundFlow.feeAmount).isZero()
              ? [
                  {
                    asset: fundFlow.feeCurrency,
                    amount: parseDecimal(fundFlow.feeAmount),
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],
          operation: classification.operation,
          blockchain: {
            name: fundFlow.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
          note: classification.note,

          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'substrate',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Processed Substrate transaction ${normalizedTx.id} - ` +
            `Operation: ${classification.operation.category}/${classification.operation.type}, ` +
            `Primary: ${fundFlow.primary.amount} ${fundFlow.primary.asset} (${direction}), ` +
            `Chain: ${fundFlow.chainName}`
        );
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const failedTransactions = processingErrors.length;

    // STRICT MODE: Fail if ANY transactions could not be processed
    // This is critical for portfolio accuracy - we cannot afford to silently drop transactions
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for ${this.chainConfig.chainName}:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txId.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedTransactions}/${totalInputTransactions} transactions failed to process. ` +
          `Lost ${failedTransactions} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.txId.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }
}
