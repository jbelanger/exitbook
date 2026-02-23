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
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

import { analyzeCosmosFundFlow, deduplicateByEventId, determineOperationFromFundFlow } from './processor-utils.js';

/**
 * Generic Cosmos SDK transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Works with any Cosmos SDK-based chain (Injective, Osmosis, etc.)
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

  protected async transformNormalizedData(
    normalizedData: CosmosTransaction[],
    context: AddressContext
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
      try {
        const fundFlow = analyzeCosmosFundFlow(transaction, context, this.chainConfig);

        const classification = determineOperationFromFundFlow(fundFlow);

        // Record fee only if user was the sender (they paid it). This covers:
        // 1. Any outflows (sent funds, delegated, swapped, etc.)
        // 2. User-initiated transactions with no outflows (governance votes, contract calls, etc.)
        // Addresses are normalized to lowercase via CosmosAddressSchema.
        const userInitiatedTransaction = transaction.from === context.primaryAddress;
        const shouldRecordFeeEntry = fundFlow.outflows.length > 0 || userInitiatedTransaction;

        let hasAssetIdError = false;
        const inflows = [];
        for (const inflow of fundFlow.inflows) {
          const assetIdResult = this.buildCosmosAssetId(inflow, transaction.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for inflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txId: transaction.id });
            this.logger.error(
              `${errorMsg} for ${this.chainConfig.chainName} transaction ${transaction.id} - THIS TRANSACTION WILL BE LOST`
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
          const assetIdResult = this.buildCosmosAssetId(outflow, transaction.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for outflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txId: transaction.id });
            this.logger.error(
              `${errorMsg} for ${this.chainConfig.chainName} transaction ${transaction.id} - THIS TRANSACTION WILL BE LOST`
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
          processingErrors.push({ error: errorMsg, txId: transaction.id });
          this.logger.error(
            `${errorMsg} for ${this.chainConfig.chainName} transaction ${transaction.id} - THIS TRANSACTION WILL BE LOST`
          );
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        const processedTransaction: ProcessedTransaction = {
          externalId: transaction.id,
          datetime: new Date(transaction.timestamp).toISOString(),
          timestamp: transaction.timestamp,
          source: this.chainConfig.chainName,
          sourceType: 'blockchain',
          status: transaction.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          movements: {
            inflows,
            outflows,
          },

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
            block_height: transaction.blockHeight,
            transaction_hash: transaction.id,
            is_confirmed: transaction.status === 'success',
          },
        };

        // Collect token movements (with denom) for batch scam detection
        const isAirdrop = fundFlow.outflows.length === 0 && !userInitiatedTransaction;
        for (const movement of [...fundFlow.inflows, ...fundFlow.outflows]) {
          if (!movement.denom) continue;
          movementsForScamDetection.push({
            contractAddress: movement.denom, // Cosmos uses denom as the token identifier
            asset: movement.asset,
            amount: parseDecimal(movement.amount),
            isAirdrop,
            transactionIndex: universalTransactions.length,
          });
        }

        universalTransactions.push(processedTransaction);
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txId: transaction.id });
        this.logger.error(`${errorMsg} for ${transaction.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Cosmos has no metadata service, so scam detection is symbol-only
    if (movementsForScamDetection.length > 0 && this.scamDetectionService) {
      this.markScamTransactions(universalTransactions, movementsForScamDetection, new Map());
      this.logger.debug(`Applied symbol-only scam detection to ${universalTransactions.length} transactions`);
    }

    // Fail if ANY transactions could not be processed - silently dropping txs corrupts portfolio accuracy
    const totalInputTransactions = deduplicatedData.length;
    const failedTransactions = processingErrors.length;
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for ${this.chainConfig.chainName}:\n${processingErrors
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
