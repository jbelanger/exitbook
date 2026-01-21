import type { XrpChainConfig, XrpTransaction } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, parseDecimal } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import { analyzeXrpFundFlow, determineXrpTransactionType } from './processor-utils.js';

/**
 * XRP transaction processor that converts raw XRPL transaction data
 * into ProcessedTransaction format. Uses balance changes from transaction metadata
 * to determine fund flow and net effect on wallet balance.
 */
export class XrpTransactionProcessor extends BaseTransactionProcessor {
  private readonly chainConfig: XrpChainConfig;

  constructor(chainConfig: XrpChainConfig, scamDetectionService?: IScamDetectionService) {
    super(chainConfig.chainName, undefined, scamDetectionService);
    this.chainConfig = chainConfig;
  }

  /**
   * Process normalized XRP transactions with balance change analysis.
   * Handles XrpTransaction objects with balance change metadata.
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as XrpTransaction;

      try {
        // Perform fund flow analysis using balance changes
        const fundFlowResult = analyzeXrpFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for XRP transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Parse amounts
        const netAmount = parseDecimal(fundFlow.netAmount);
        const feeAmount = parseDecimal(normalizedTx.feeAmount);
        const zeroDecimal = parseDecimal('0');

        // Build assetId for XRP native asset
        const assetIdResult = buildBlockchainNativeAssetId(this.chainConfig.chainName);
        if (assetIdResult.isErr()) {
          const errorMsg = `Failed to build assetId: ${assetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for XRP transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const assetId = assetIdResult.value;

        // For XRP (account-based), fees are paid separately from the balance
        // This is different from Bitcoin (UTXO-based) where fees are carved from inputs
        const shouldRecordFeeEntry = fundFlow.isOutgoing && !netAmount.isZero();
        const effectiveFeeAmount = shouldRecordFeeEntry ? feeAmount : zeroDecimal;

        // Net amount is derived from balance changes and already includes fees.
        // To avoid double-counting, subtract the fee from the transfer amount when we record a fee entry.
        let transferAmount = netAmount;
        if (shouldRecordFeeEntry && !effectiveFeeAmount.isZero()) {
          transferAmount = netAmount.minus(effectiveFeeAmount);
          if (transferAmount.isNegative()) {
            this.logger.warn(
              {
                txId: normalizedTx.id,
                netAmount: netAmount.toFixed(),
                feeAmount: effectiveFeeAmount.toFixed(),
              },
              'XRP fee exceeds net balance change; treating as fee-only transaction'
            );
            transferAmount = zeroDecimal;
          }
        }

        // Calculate movement amounts
        // For account-based chains, the net amount is the balance change
        // Fees are recorded separately with settlement='balance'
        const hasOutflow = fundFlow.isOutgoing && !transferAmount.isZero();
        const hasInflow = fundFlow.isIncoming && !netAmount.isZero();

        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp, // Already in milliseconds from mapper
          source: this.chainConfig.chainName,
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from balance change analysis
          // For account-based chains:
          // - Incoming: grossAmount/netAmount are the balance change
          // - Outgoing: transfer amount excludes the fee (fee recorded separately)
          movements: {
            outflows: hasOutflow
              ? [
                  {
                    assetId,
                    assetSymbol: this.chainConfig.nativeCurrency,
                    grossAmount: transferAmount,
                    netAmount: transferAmount,
                  },
                ]
              : [],
            inflows: hasInflow
              ? [
                  {
                    assetId,
                    assetSymbol: this.chainConfig.nativeCurrency,
                    grossAmount: netAmount,
                    netAmount: netAmount,
                  },
                ]
              : [],
          },

          // Fees are paid separately from the account balance (settlement='balance')
          fees:
            shouldRecordFeeEntry && !effectiveFeeAmount.isZero()
              ? [
                  {
                    assetId,
                    assetSymbol: normalizedTx.feeCurrency,
                    amount: effectiveFeeAmount,
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: {
            category: 'transfer',
            type: determineXrpTransactionType(normalizedTx, context),
          },

          blockchain: {
            name: this.chainConfig.chainName,
            block_height: normalizedTx.ledgerIndex,
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
        `CRITICAL PROCESSING FAILURE for XRP:\n${processingErrors
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
