import {
  type BitcoinChainConfig,
  type BitcoinTransaction,
  BitcoinTransactionSchema,
} from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, parseDecimal, type Currency } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

import { analyzeBitcoinFundFlow } from './processor-utils.js';

export class BitcoinTransactionProcessor extends BaseTransactionProcessor<BitcoinTransaction> {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(chainConfig: BitcoinChainConfig, scamDetectionService?: IScamDetectionService) {
    super(chainConfig.chainName, undefined, scamDetectionService);
    this.chainConfig = chainConfig;
  }

  protected get inputSchema() {
    return BitcoinTransactionSchema;
  }

  protected async transformNormalizedData(
    normalizedData: BitcoinTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const normalizedTx of normalizedData) {
      try {
        const fundFlowResult = analyzeBitcoinFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for Bitcoin transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        const walletInputAmount = parseDecimal(fundFlow.walletInput);
        const walletOutputAmount = parseDecimal(fundFlow.walletOutput);
        const feeAmount = parseDecimal(normalizedTx.feeAmount || '0');
        const zeroDecimal = parseDecimal('0');

        const shouldRecordFeeEntry = fundFlow.isOutgoing && !walletInputAmount.isZero();
        const effectiveFeeAmount = shouldRecordFeeEntry ? feeAmount : zeroDecimal;

        const assetIdResult = buildBlockchainNativeAssetId(this.chainConfig.chainName);
        if (assetIdResult.isErr()) {
          const errorMsg = `Failed to build assetId: ${assetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for Bitcoin transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const assetId = assetIdResult.value;

        // grossOutflow: balance impact (amount removed from wallet after accounting for change)
        // netOutflow: amount that actually left to external parties (excludes change and fees)
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

        const includeWalletOutputAsInflow = !walletOutputAmount.isZero();
        const hasOutflow = !grossOutflowAmount.isZero();

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

        transactions.push(processedTransaction);
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    const totalInputTransactions = normalizedData.length;
    const failedTransactions = processingErrors.length;

    // Fail hard if any transactions could not be processed - silently dropping would corrupt portfolio calculations
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for Bitcoin:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txId.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        this.buildProcessingFailureError(
          failedTransactions,
          totalInputTransactions,
          processingErrors.map((e) => ({ id: e.txId, error: e.error }))
        )
      );
    }

    return okAsync(transactions);
  }
}
