import {
  type CosmosChainConfig,
  type CosmosTransaction,
  CosmosTransactionSchema,
} from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, parseDecimal } from '@exitbook/core';
import { type Result, err, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import {
  analyzeFundFlowFromNormalized,
  deduplicateByEventId,
  determineOperationFromFundFlow,
} from './processor-utils.js';

/**
 * Generic Cosmos SDK transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Works with any Cosmos SDK-based chain (Injective, Osmosis, etc.)
 * Uses ProcessorFactory to dispatch to provider-specific processors based on data provenance.
 * Enhanced with sophisticated fund flow analysis.
 */
export class CosmosProcessor extends BaseTransactionProcessor<CosmosTransaction> {
  private chainConfig: CosmosChainConfig;

  constructor(chainConfig: CosmosChainConfig, scamDetectionService?: IScamDetectionService) {
    super(chainConfig.chainName, undefined, scamDetectionService);
    this.chainConfig = chainConfig;
  }

  protected get inputSchema() {
    return CosmosTransactionSchema;
  }

  /**
   * Process normalized CosmosTransaction data with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: CosmosTransaction[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Deduplicate by eventId (handles cases like Peggy deposits where multiple validators
    // submit the same deposit claim as different tx hashes but represent the same logical event)
    const deduplicatedData = deduplicateByEventId(normalizedData);
    if (deduplicatedData.length < normalizedData.length) {
      this.logger.info(
        `Deduplicated ${normalizedData.length - deduplicatedData.length} transactions by eventId (${normalizedData.length} → ${deduplicatedData.length})`
      );
    }

    const universalTransactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];
    const movementsForScamDetection: MovementWithContext[] = [];

    for (const transaction of deduplicatedData) {
      const normalizedTx = transaction;
      try {
        // Analyze fund flow for sophisticated transaction classification
        const fundFlow = analyzeFundFlowFromNormalized(normalizedTx, context, this.chainConfig);

        // Determine operation classification based on fund flow
        const classification = determineOperationFromFundFlow(fundFlow);

        // Only include fees if user was the sender (they paid the fee)
        // For incoming transactions (deposits, received transfers), the sender/validator paid the fee
        // Record fee entry if:
        // 1. They have ANY outflows (sent funds, delegated, swapped, etc.) OR
        // 2. They initiated a transaction with no outflows (governance votes, contract calls, etc.)
        // Note: Addresses are already normalized to lowercase via CosmosAddressSchema
        const userInitiatedTransaction = normalizedTx.from === context.primaryAddress;
        const shouldRecordFeeEntry = fundFlow.outflows.length > 0 || userInitiatedTransaction;

        // Build movements with assetId
        let hasAssetIdError = false;
        const inflows = [];
        for (const inflow of fundFlow.inflows) {
          const assetIdResult = this.buildCosmosAssetId(inflow, normalizedTx.id);
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
          const assetIdResult = this.buildCosmosAssetId(outflow, normalizedTx.id);
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

        // Build fee assetId (always native asset for Cosmos)
        const feeAssetIdResult = buildBlockchainNativeAssetId(this.chainConfig.chainName);
        if (feeAssetIdResult.isErr()) {
          const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(
            `${errorMsg} for ${this.chainConfig.chainName} transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
          );
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        // Convert to ProcessedTransaction with enhanced metadata
        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: this.chainConfig.chainName,
          sourceType: 'blockchain',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows,
            outflows,
          },

          // Structured fees - only deduct from balance if user paid them
          fees:
            shouldRecordFeeEntry && !parseDecimal(fundFlow.feeAmount).isZero()
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

          notes: classification.notes,

          blockchain: {
            name: this.chainConfig.chainName,
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
        };

        // Collect token movements for batch scam detection later
        const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
        const isAirdrop = fundFlow.outflows.length === 0 && !userInitiatedTransaction;

        for (const movement of allMovements) {
          if (!movement.denom) {
            continue;
          }
          movementsForScamDetection.push({
            contractAddress: movement.denom, // Cosmos uses denom as identifier
            asset: movement.asset,
            amount: parseDecimal(movement.amount),
            isAirdrop,
            transactionIndex: universalTransactions.length, // Index of transaction we're about to push
          });
        }

        universalTransactions.push(universalTransaction);
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Batch scam detection: Cosmos has no metadata service, so detection is symbol-only
    // Token movements only (skip native denom)
    if (movementsForScamDetection.length > 0 && this.scamDetectionService) {
      this.applyScamDetection(universalTransactions, movementsForScamDetection, new Map());
      this.logger.debug(`Applied symbol-only scam detection to ${universalTransactions.length} transactions`);
    }

    // Log processing summary
    const totalInputTransactions = deduplicatedData.length;
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

    return okAsync(universalTransactions);
  }

  /**
   * Build assetId for a Cosmos movement
   * - Native asset: blockchain:<chain>:native (always check symbol first!)
   * - Token with denom (IBC, CW20, factory, etc.): blockchain:<chain>:<denom>
   * - Token without denom (edge case): fail-fast with an error
   *
   * CRITICAL: Check if asset is native BEFORE checking for denom.
   * Bridge transactions (e.g., Peggy from Ethereum) may include a tokenAddress (the Ethereum
   * contract address) even for native assets. We must prioritize the asset symbol to avoid
   * creating duplicate assetIds for the same native currency.
   *
   * Per Asset Identity Specification, denom should be available for IBC and CW20 tokens.
   * If missing for a non-native asset, we fail-fast to prevent silent data corruption.
   */
  private buildCosmosAssetId(
    movement: {
      asset: string;
      denom?: string | undefined;
    },
    transactionId: string
  ): Result<string, Error> {
    const assetSymbol = movement.asset.trim().toUpperCase();
    const nativeSymbol = this.chainConfig.nativeCurrency.toUpperCase();

    // Check if it's the native asset FIRST (regardless of whether denom is present)
    // This handles bridge scenarios where native assets have Ethereum contract addresses
    if (assetSymbol === nativeSymbol) {
      return buildBlockchainNativeAssetId(this.chainConfig.chainName);
    }

    const nativeDenom = this.chainConfig.nativeDenom?.trim().toUpperCase();
    if (nativeDenom && assetSymbol === nativeDenom) {
      this.logger.warn(
        `Asset symbol matched native denom (${nativeDenom}) instead of native currency (${nativeSymbol}) in transaction ${transactionId}. Treating as native asset.`
      );
      return buildBlockchainNativeAssetId(this.chainConfig.chainName);
    }

    // Non-native asset - must have denom
    if (!movement.denom) {
      return err(new Error(`Missing denom for non-native asset ${movement.asset} in transaction ${transactionId}`));
    }

    // Token with denom (IBC, CW20, factory, etc.)
    return buildBlockchainTokenAssetId(this.chainConfig.chainName, movement.denom);
  }
}
