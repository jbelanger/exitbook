import {
  type BitcoinChainConfig,
  type BitcoinTransaction,
  BitcoinTransactionSchema,
} from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, parseDecimal, type Currency } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import { analyzeBitcoinFundFlow } from './processor-utils.js';

/**
 * Bitcoin transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance. Optimized for multi-address processing using session context.
 */
export class BitcoinTransactionProcessor extends BaseTransactionProcessor<BitcoinTransaction> {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(chainConfig: BitcoinChainConfig, scamDetectionService?: IScamDetectionService) {
    super(chainConfig.chainName, undefined, scamDetectionService);
    this.chainConfig = chainConfig;
  }

  protected get inputSchema() {
    return BitcoinTransactionSchema;
  }

  /**
   * Process normalized Bitcoin transactions with enhanced fund flow analysis.
   * Handles NormalizedBitcoinTransaction objects with structured input/output data.
   */
  protected async processInternal(
    normalizedData: BitcoinTransaction[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const normalizedTx of normalizedData) {
      try {
        // Perform enhanced fund flow analysis with structured input/output data
        const fundFlowResult = analyzeBitcoinFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for Bitcoin transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Store actual network fees for reporting
        // For consistency with account-based blockchains, we record fees separately
        // and subtract them from outflows to avoid double-counting
        const walletInputAmount = parseDecimal(fundFlow.walletInput);
        const walletOutputAmount = parseDecimal(fundFlow.walletOutput);
        const feeAmount = parseDecimal(normalizedTx.feeAmount || '0');
        const zeroDecimal = parseDecimal('0');

        const shouldRecordFeeEntry = fundFlow.isOutgoing && !walletInputAmount.isZero();
        const effectiveFeeAmount = shouldRecordFeeEntry ? feeAmount : zeroDecimal;

        // Build assetId for native asset
        const assetIdResult = buildBlockchainNativeAssetId(this.chainConfig.chainName);
        if (assetIdResult.isErr()) {
          const errorMsg = `Failed to build assetId: ${assetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for Bitcoin transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const assetId = assetIdResult.value;

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

        // Per-address model: include outputs to this address as inflows
        const includeWalletOutputAsInflow = !walletOutputAmount.isZero();
        const hasOutflow = !grossOutflowAmount.isZero();

        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: this.chainConfig.chainName,
          sourceType: 'blockchain',
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
                    assetId,
                    assetSymbol: this.chainConfig.nativeCurrency,
                    grossAmount: grossOutflowAmount,
                    netAmount: netOutflowAmount,
                  },
                ]
              : [],
            inflows: includeWalletOutputAsInflow
              ? [
                  {
                    assetId,
                    assetSymbol: this.chainConfig.nativeCurrency,
                    grossAmount: walletOutputAmount,
                    netAmount: walletOutputAmount,
                  },
                ]
              : [],
          },

          fees:
            shouldRecordFeeEntry && !feeAmount.isZero()
              ? [
                  {
                    assetId,
                    assetSymbol: (normalizedTx.feeCurrency || this.chainConfig.nativeCurrency) as Currency,
                    amount: feeAmount,
                    scope: 'network',
                    settlement: 'on-chain',
                  },
                ]
              : [],

          operation: {
            category: 'transfer',
            type: 'transfer',
          },

          blockchain: {
            name: this.chainConfig.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
        };

        transactions.push(universalTransaction);
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
        `CRITICAL PROCESSING FAILURE for Bitcoin:\n${processingErrors
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
