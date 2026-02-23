import {
  type SubstrateTransaction,
  type SubstrateChainConfig,
  SubstrateTransactionSchema,
} from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, parseDecimal } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

import { analyzeSubstrateFundFlow, determineOperationFromFundFlow, shouldRecordFeeEntry } from './processor-utils.js';

/**
 * Generic Substrate transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Supports Polkadot, Kusama, Bittensor, and other
 * Substrate-based chains. Uses ProcessorFactory to dispatch to provider-specific
 * processors based on data provenance.
 */
export class SubstrateProcessor extends BaseTransactionProcessor<SubstrateTransaction> {
  private chainConfig: SubstrateChainConfig;

  constructor(chainConfig: SubstrateChainConfig, scamDetectionService?: IScamDetectionService) {
    super(chainConfig.chainName, undefined, scamDetectionService);
    this.chainConfig = chainConfig;
  }

  protected get inputSchema() {
    return SubstrateTransactionSchema;
  }

  /**
   * Process normalized SubstrateTransaction data with sophisticated fund flow analysis
   */
  protected async transformNormalizedData(
    normalizedData: SubstrateTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const normalizedTx of normalizedData) {
      try {
        const fundFlowResult = analyzeSubstrateFundFlow(normalizedTx, context, this.chainConfig);
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

        // Only include fees if user was the signer/broadcaster (they paid the fee)
        // For incoming transactions (deposits, received transfers), the sender/protocol paid the fee
        const shouldRecordFee = shouldRecordFeeEntry(normalizedTx, fundFlow, context.primaryAddress);

        // Build movements with assetId (per-movement to support future multi-asset Substrate chains)
        let hasAssetIdError = false;
        const inflows = [];
        for (const inflow of fundFlow.inflows) {
          const assetIdResult = this.buildSubstrateAssetId(inflow.asset, normalizedTx.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for inflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
            this.logger.error(
              `${errorMsg} for ${this.chainConfig.chainName} transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
            );
            hasAssetIdError = true;
            break;
          }

          const amount = parseDecimal(inflow.amount);
          inflows.push({
            assetId: assetIdResult.value,
            assetSymbol: inflow.asset,
            grossAmount: amount,
            netAmount: amount,
          });
        }

        if (hasAssetIdError) {
          continue;
        }

        const outflows = [];
        for (const outflow of fundFlow.outflows) {
          const assetIdResult = this.buildSubstrateAssetId(outflow.asset, normalizedTx.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for outflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
            this.logger.error(
              `${errorMsg} for ${this.chainConfig.chainName} transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
            );
            hasAssetIdError = true;
            break;
          }

          const amount = parseDecimal(outflow.amount);
          outflows.push({
            assetId: assetIdResult.value,
            assetSymbol: outflow.asset,
            grossAmount: amount,
            netAmount: amount,
          });
        }

        if (hasAssetIdError) {
          continue;
        }

        // Build fee assetId (always native asset for Substrate)
        const feeAssetIdResult = this.buildSubstrateAssetId(fundFlow.feeCurrency, normalizedTx.id);
        if (feeAssetIdResult.isErr()) {
          const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(
            `${errorMsg} for ${this.chainConfig.chainName} transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
          );
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        const processedTransaction: ProcessedTransaction = {
          movements: {
            inflows,
            outflows,
          },
          fees:
            shouldRecordFee && !parseDecimal(fundFlow.feeAmount).isZero()
              ? [
                  {
                    assetId: feeAssetId,
                    assetSymbol: fundFlow.feeCurrency,
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
          notes: classification.notes,

          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: this.chainConfig.chainName,
          sourceType: 'blockchain',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,
        };

        transactions.push(processedTransaction);

        this.logger.debug(
          `Processed Substrate transaction ${normalizedTx.id} - ` +
            `Operation: ${classification.operation.category}/${classification.operation.type}, ` +
            `Primary: ${fundFlow.primary.amount} ${fundFlow.primary.asset}, ` +
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

  /**
   * Build assetId for a Substrate movement
   * - Native asset: blockchain:<chain>:native
   * - Non-native asset: fail-fast (not yet supported)
   *
   * Per Asset Identity Specification, current Substrate ingestion only supports native assets.
   * Modern Substrate chains (Asset Hub, parachains) support multi-asset via pallet-assets,
   * but SubstrateMovement lacks tokenAddress/assetRef fields. This method validates that
   * the asset symbol matches the native currency and fails-fast if not, preventing silent
   * data corruption until proper multi-asset support is added.
   */
  private buildSubstrateAssetId(assetSymbol: string, transactionId: string): Result<string, Error> {
    const normalizedSymbol = assetSymbol.trim().toUpperCase();
    const nativeSymbol = this.chainConfig.nativeCurrency.toUpperCase();

    if (normalizedSymbol === nativeSymbol) {
      return buildBlockchainNativeAssetId(this.chainConfig.chainName);
    }

    // Non-native asset detected but we don't have tokenAddress/assetRef yet
    // Fail-fast to prevent incorrect assetId generation
    return err(
      new Error(
        `Non-native asset ${assetSymbol} detected in ${this.chainConfig.chainName} transaction ${transactionId}. ` +
          `SubstrateMovement lacks tokenAddress field for multi-asset support. ` +
          `Add tokenAddress to SubstrateMovement type to support Asset Hub and parachain tokens.`
      )
    );
  }
}
