import type { CardanoTransaction } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/processing/base-transaction-processor.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import { analyzeCardanoFundFlow, determineCardanoTransactionType } from './processor-utils.js';

/**
 * Cardano transaction processor that converts normalized blockchain transaction data
 * into ProcessedTransaction format.
 *
 * Cardano is a UTXO-based blockchain with native multi-asset support:
 * - Each transaction has inputs (UTXOs being spent) and outputs (new UTXOs created)
 * - Each input/output can contain multiple assets (ADA + native tokens)
 * - Fees are always paid in ADA
 *
 * Processing approach:
 * 1. Analyze inputs/outputs to determine which belong to user addresses
 * 2. Track movements for EACH asset separately
 * 3. Consolidate duplicate assets by summing amounts
 * 4. Determine transaction type based on fund flow direction
 */
export class CardanoTransactionProcessor extends BaseTransactionProcessor {
  constructor() {
    super('cardano');
  }

  /**
   * Process normalized Cardano transactions with multi-asset UTXO analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txHash: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as CardanoTransaction;

      try {
        // Perform fund flow analysis with multi-asset tracking
        const fundFlowResult = analyzeCardanoFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
          this.logger.error(`${errorMsg} for Cardano transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow
        const transactionType = determineCardanoTransactionType(fundFlow);

        // Calculate fee details
        const feeAmount = parseDecimal(fundFlow.feeAmount || '0');
        const userPaidFee = fundFlow.feePaidByUser && !feeAmount.isZero();

        // Build movements from fund flow
        // Convert to ProcessedTransaction format
        // ADR-005: For UTXO chains, grossAmount includes fees, netAmount is the actual transfer amount
        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'cardano',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from multi-asset UTXO analysis
          movements: {
            inflows: fundFlow.inflows.map((inflow) => {
              const amount = parseDecimal(inflow.amount);
              return {
                asset: inflow.asset,
                grossAmount: amount,
                netAmount: amount, // Inflows: no fee adjustment needed
              };
            }),
            outflows: fundFlow.outflows.map((outflow) => {
              const grossAmount = parseDecimal(outflow.amount);
              // For ADA outflows when user paid fee: netAmount = grossAmount - fee
              // For other assets or when no fee: netAmount = grossAmount
              const netAmount = outflow.asset === 'ADA' && userPaidFee ? grossAmount.minus(feeAmount) : grossAmount;

              return {
                asset: outflow.asset,
                grossAmount, // Includes fee (total that left wallet)
                netAmount, // Actual transfer amount (excludes fee)
              };
            }),
          },

          fees: userPaidFee
            ? [
                {
                  asset: fundFlow.feeCurrency,
                  amount: feeAmount,
                  scope: 'network',
                  settlement: 'on-chain',
                },
              ]
            : [],

          operation: {
            category: 'transfer',
            type: transactionType,
          },

          blockchain: {
            name: 'cardano',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Add note if there's classification uncertainty
          note: fundFlow.classificationUncertainty
            ? {
                message: fundFlow.classificationUncertainty,
                metadata: {
                  inflows: fundFlow.inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
                  outflows: fundFlow.outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
                },
                severity: 'info',
                type: 'classification_uncertain',
              }
            : undefined,
        };

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed transaction ${universalTransaction.externalId} - Type: ${transactionType}, Primary: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
        );
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txHash: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const failedTransactions = processingErrors.length;

    // STRICT MODE: Fail if ANY transactions could not be processed
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for Cardano:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txHash.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedTransactions}/${totalInputTransactions} transactions failed to process. ` +
          `Lost ${failedTransactions} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.txHash.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }
}
