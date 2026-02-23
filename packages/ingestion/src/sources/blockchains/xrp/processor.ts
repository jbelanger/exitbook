import { type XrpChainConfig, type XrpTransaction, XrpTransactionSchema } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, parseDecimal, type Currency } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

import { analyzeXrpFundFlow, determineXrpTransactionType } from './processor-utils.js';

/**
 * XRP transaction processor that converts raw XRPL transaction data
 * into ProcessedTransaction format. Uses balance changes from transaction metadata
 * to determine fund flow and net effect on wallet balance.
 */
export class XrpProcessor extends BaseTransactionProcessor<XrpTransaction> {
  private readonly chainConfig: XrpChainConfig;

  constructor(chainConfig: XrpChainConfig, scamDetectionService?: IScamDetectionService) {
    super(chainConfig.chainName, undefined, scamDetectionService);
    this.chainConfig = chainConfig;
  }

  protected get inputSchema() {
    return XrpTransactionSchema;
  }

  protected transformNormalizedData(
    normalizedData: XrpTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const normalizedTx of normalizedData) {
      try {
        const fundFlowResult = analyzeXrpFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for XRP transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        const netAmount = parseDecimal(fundFlow.netAmount);
        const feeAmount = parseDecimal(normalizedTx.feeAmount);

        const assetIdResult = buildBlockchainNativeAssetId(this.chainConfig.chainName);
        if (assetIdResult.isErr()) {
          const errorMsg = `Failed to build assetId: ${assetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for XRP transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const assetId = assetIdResult.value;

        // For account-based XRP, balance changes already include the fee.
        // When recording a fee entry separately, subtract it from the transfer amount to avoid double-counting.
        const shouldRecordFeeEntry = fundFlow.isOutgoing && !netAmount.isZero();

        let transferAmount = netAmount;
        if (shouldRecordFeeEntry && !feeAmount.isZero()) {
          transferAmount = netAmount.minus(feeAmount);
          if (transferAmount.isNegative()) {
            this.logger.warn(
              { txId: normalizedTx.id, netAmount: netAmount.toFixed(), feeAmount: feeAmount.toFixed() },
              'XRP fee exceeds net balance change; treating as fee-only transaction'
            );
            transferAmount = parseDecimal('0');
          }
        }

        const hasOutflow = fundFlow.isOutgoing && !transferAmount.isZero();
        const hasInflow = fundFlow.isIncoming && !netAmount.isZero();

        // Skip transactions with no accounting impact (external txs or failed txs with no balance change)
        if (!hasOutflow && !hasInflow && !shouldRecordFeeEntry) {
          this.logger.debug(
            { txId: normalizedTx.id, status: normalizedTx.status },
            'Skipping transaction with no accounting impact'
          );
          continue;
        }

        const processedTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: this.chainConfig.chainName,
          sourceType: 'blockchain',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

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
              ? [{ assetId, assetSymbol: this.chainConfig.nativeCurrency, grossAmount: netAmount, netAmount }]
              : [],
          },

          // XRP fees are settled from account balance, not carved from the transfer amount
          fees:
            shouldRecordFeeEntry && !feeAmount.isZero()
              ? [
                  {
                    assetId,
                    assetSymbol: normalizedTx.feeCurrency as Currency,
                    amount: feeAmount,
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: {
            category: 'transfer',
            type: determineXrpTransactionType(normalizedTx),
          },

          blockchain: {
            name: this.chainConfig.chainName,
            block_height: normalizedTx.ledgerIndex,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
        };

        transactions.push(processedTransaction);
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
      }
    }

    const totalInputTransactions = normalizedData.length;
    const failedTransactions = processingErrors.length;

    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for XRP:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txId.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return Promise.resolve(
        err(
          this.buildProcessingFailureError(
            failedTransactions,
            totalInputTransactions,
            processingErrors.map((e) => ({ id: e.txId, error: e.error }))
          )
        )
      );
    }

    return Promise.resolve(ok(transactions));
  }
}
