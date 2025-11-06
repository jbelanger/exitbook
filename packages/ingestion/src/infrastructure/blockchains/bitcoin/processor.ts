import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { BitcoinTransaction } from '@exitbook/providers';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.js';

import { analyzeBitcoinFundFlow, determineBitcoinTransactionType } from './processor-utils.js';

/**
 * Bitcoin transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Optimized for multi-address processing using session context.
 */
export class BitcoinTransactionProcessor extends BaseTransactionProcessor {
  constructor() {
    super('bitcoin');
  }

  /**
   * Process normalized Bitcoin transactions with enhanced fund flow analysis.
   * Handles NormalizedBitcoinTransaction objects with structured input/output data.
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Bitcoin transactions`);

    const transactions: UniversalTransaction[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as BitcoinTransaction;

      try {
        // Perform enhanced fund flow analysis with structured input/output data
        const fundFlowResult = analyzeBitcoinFundFlow(normalizedTx, sessionMetadata);

        if (fundFlowResult.isErr()) {
          this.logger.warn(`Fund flow analysis failed for ${normalizedTx.id}: ${fundFlowResult.error}`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type based on fund flow
        const transactionType = determineBitcoinTransactionType(fundFlow, sessionMetadata);

        // Store actual network fees for reporting
        // For consistency with account-based blockchains, we record fees separately
        // and subtract them from outflows to avoid double-counting
        const walletInputAmount = parseDecimal(fundFlow.walletInput);
        const walletOutputAmount = parseDecimal(fundFlow.walletOutput);
        const feeAmount = parseDecimal(normalizedTx.feeAmount || '0');
        const zeroDecimal = parseDecimal('0');

        const userPaidFee = fundFlow.isOutgoing && !walletInputAmount.isZero();
        const effectiveFeeAmount = userPaidFee ? feeAmount : zeroDecimal;

        // Measure wallet spend in two views:
        // - grossOutflow: balance impact (amount removed from wallet after accounting for change)
        // - netOutflow: amount that actually left to external parties (excludes change, still excludes fees)
        let grossOutflowAmount = zeroDecimal;
        let netOutflowAmount = zeroDecimal;

        if (!walletInputAmount.isZero()) {
          if (fundFlow.isOutgoing) {
            const baseOutflow = walletInputAmount.minus(walletOutputAmount);
            grossOutflowAmount = baseOutflow.isNegative() ? zeroDecimal : baseOutflow;
          } else {
            grossOutflowAmount = walletInputAmount;
          }

          netOutflowAmount = grossOutflowAmount.minus(effectiveFeeAmount);

          if (netOutflowAmount.isNegative()) {
            netOutflowAmount = zeroDecimal;
          }
        }

        const includeWalletOutputAsInflow = transactionType !== 'withdrawal' && !walletOutputAmount.isZero();
        const hasOutflow = !grossOutflowAmount.isZero();

        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'bitcoin',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from UTXO analysis
          // - Outflow grossAmount captures the BTC removed from wallet balance (after removing change)
          // - Outflow netAmount captures what actually left the wallet after on-chain fees
          // - Inflows are only recorded for bona fide incoming funds (deposits / true transfers)
          // Network fees remain explicit in the fees array
          movements: {
            outflows: hasOutflow
              ? [
                  {
                    asset: 'BTC',
                    grossAmount: grossOutflowAmount,
                    netAmount: netOutflowAmount,
                  },
                ]
              : [],
            inflows: includeWalletOutputAsInflow
              ? [
                  {
                    asset: 'BTC',
                    grossAmount: walletOutputAmount,
                    netAmount: walletOutputAmount,
                  },
                ]
              : [],
          },

          fees:
            userPaidFee && !feeAmount.isZero()
              ? [
                  {
                    asset: normalizedTx.feeCurrency || 'BTC',
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
            name: 'bitcoin',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          metadata: {
            providerId: normalizedTx.providerId,
          },
        };

        transactions.push(universalTransaction);
        this.logger.debug(`Successfully processed normalized transaction ${universalTransaction.externalId}`);
      } catch (error) {
        this.logger.error(`Failed to process normalized transaction ${normalizedTx.id}: ${String(error)}`);
        continue;
      }
    }

    this.logger.info(`Normalized processing completed: ${transactions.length} transactions processed successfully`);
    return okAsync(transactions);
  }
}
