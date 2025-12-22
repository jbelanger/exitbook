import type { NearTransaction } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, parseDecimal } from '@exitbook/core';
import { type Result, err, ok, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import { analyzeNearFundFlow, classifyNearOperationFromFundFlow } from './processor-utils.js';

/**
 * NEAR transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class NearTransactionProcessor extends BaseTransactionProcessor {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;

  constructor(tokenMetadataService: ITokenMetadataService) {
    super('near', tokenMetadataService);
  }

  /**
   * Process normalized data (structured NearTransaction objects)
   * with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Enrich all transactions with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as NearTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txId: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as NearTransaction;

      try {
        // Phase 2 enrichment check: Warn if accountChanges are missing
        // This indicates the importer's enrichment step failed and the processor is in degraded mode
        if (!normalizedTx.accountChanges || normalizedTx.accountChanges.length === 0) {
          this.logger.warn(
            `Transaction ${normalizedTx.id} missing accountChanges - enrichment data unavailable. Balance calculations may be inaccurate.`
          );
        }

        // Perform enhanced fund flow analysis
        const fundFlowResult = analyzeNearFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for NEAR transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type and operation classification based on fund flow
        const classification = classifyNearOperationFromFundFlow(fundFlow, normalizedTx.actions || []);

        // Fix Issue #78: Record fees when the user paid them and they aren't already accounted for
        // within remaining NEAR outflows. When the fee fully consumes the NEAR movement (fee-only
        // transactions), we still need an explicit fee entry to avoid undercounting balances.
        const feeAccountedInMovements =
          fundFlow.feeAbsorbedByMovement &&
          fundFlow.outflows.some((movement) => movement.asset === (fundFlow.feeCurrency || 'NEAR'));

        const shouldRecordFeeEntry = fundFlow.feePaidByUser && !feeAccountedInMovements;

        // Build movements with assetId
        let hasAssetIdError = false;
        const inflows = [];
        for (const inflow of fundFlow.inflows) {
          const assetIdResult = this.buildNearAssetId(inflow, normalizedTx.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for inflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
            this.logger.error(`${errorMsg} for NEAR transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
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
          const assetIdResult = this.buildNearAssetId(outflow, normalizedTx.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for outflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
            this.logger.error(`${errorMsg} for NEAR transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
            hasAssetIdError = true;
            break;
          }

          // For outflows, use grossAmount if available (before fee deduction), otherwise use amount
          const netAmount = parseDecimal(outflow.amount);
          const grossAmount = outflow.grossAmount ? parseDecimal(outflow.grossAmount) : netAmount;
          outflows.push({
            assetId: assetIdResult.value,
            assetSymbol: outflow.asset,
            grossAmount,
            netAmount,
          });
        }

        if (hasAssetIdError) {
          continue;
        }

        // Build fee assetId (always NEAR for NEAR blockchain)
        const feeAssetIdResult = buildBlockchainNativeAssetId('near');
        if (feeAssetIdResult.isErr()) {
          const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, txId: normalizedTx.id });
          this.logger.error(`${errorMsg} for NEAR transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        // Convert to ProcessedTransaction with structured fields
        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'near',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows,
            outflows,
          },

          fees:
            shouldRecordFeeEntry && !parseDecimal(normalizedTx.feeAmount || '0').isZero()
              ? [
                  {
                    assetId: feeAssetId,
                    assetSymbol: normalizedTx.feeCurrency || 'NEAR',
                    amount: parseDecimal(normalizedTx.feeAmount || '0'),
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: classification.operation,

          notes: classification.notes,

          blockchain: {
            name: 'near',
            block_height: normalizedTx.blockHeight,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
        };

        // Scam detection: Check all movements (both inflows and outflows)
        const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
        for (const movement of allMovements) {
          const scamNote = await this.detectScamForAsset(movement.asset, movement.tokenAddress, {
            amount: parseDecimal(movement.amount),
            isAirdrop: fundFlow.outflows.length === 0 && !fundFlow.feePaidByUser,
          });
          if (scamNote) {
            // Apply scam detection results based on severity
            if (scamNote.severity === 'error') {
              universalTransaction.isSpam = true;
            }
            universalTransaction.notes = [...(universalTransaction.notes || []), scamNote];
            break;
          }
        }

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed transaction ${universalTransaction.externalId} - Category: ${classification.operation.category}, Type: ${classification.operation.type}, Amount: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
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
        `CRITICAL PROCESSING FAILURE for NEAR:\n${processingErrors
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
   * Enrich token metadata for all token transfers.
   * Fetches metadata upfront in batch to populate cache for later use (asset ID building, scam detection).
   */
  private async enrichTokenMetadata(transactions: NearTransaction[]): Promise<Result<void, Error>> {
    // Collect all token transfers with contract addresses for batch enrichment
    // We enrich ALL of them upfront (not just those with missing/incomplete metadata) because:
    // 1. Scam detection needs metadata for all tokens with contract addresses
    // 2. Batching all fetches upfront is more efficient than separate calls later
    const tokenTransfersToEnrich = transactions.flatMap((tx) => {
      if (!tx.tokenTransfers) return [];
      return tx.tokenTransfers.filter((transfer) => !!transfer.contractAddress);
    });

    if (tokenTransfersToEnrich.length === 0) {
      return ok(undefined);
    }

    this.logger.debug(`Enriching token metadata for ${tokenTransfersToEnrich.length} token transfers`);

    // Use the token metadata service to enrich with caching and provider fetching
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      tokenTransfersToEnrich,
      'near',
      (transfer) => transfer.contractAddress,
      (transfer, metadata) => {
        if (metadata.symbol) {
          transfer.symbol = metadata.symbol;
        }
        // Decimals are already set from provider data, but update if metadata has better info
        if (metadata.decimals !== undefined && metadata.decimals !== transfer.decimals) {
          this.logger.debug(
            `Updating decimals for ${transfer.contractAddress} from ${transfer.decimals} to ${metadata.decimals}`
          );
          transfer.decimals = metadata.decimals;
        }
      },
      (transfer) => transfer.decimals !== undefined // Enrichment failure OK if decimals already present
    );

    if (enrichResult.isErr()) {
      return err(new Error(`Failed to enrich token metadata: ${enrichResult.error.message}`));
    }

    this.logger.debug('Successfully enriched token metadata from cache/provider');
    return ok(undefined);
  }

  /**
   * Build assetId for a NEAR movement
   * - Native asset (NEAR, no tokenAddress): blockchain:near:native
   * - NEP-141 token (has contract address): blockchain:near:<contract_address>
   * - Token without contract address (edge case): fail-fast with an error
   *
   * Per Asset Identity Specification, tokenAddress (contract) should usually be available for NEP-141 tokens.
   * If missing for a non-native asset, we fail-fast to prevent silent data corruption.
   */
  private buildNearAssetId(
    movement: {
      asset: string;
      tokenAddress?: string | undefined;
    },
    transactionId: string
  ): Result<string, Error> {
    // Native asset (NEAR) - no contract address
    if (!movement.tokenAddress) {
      const assetSymbol = movement.asset.trim().toUpperCase();

      if (assetSymbol === 'NEAR') {
        return buildBlockchainNativeAssetId('near');
      }

      // If it's not NEAR and has no contract address, this is an error
      return err(
        new Error(
          `Missing tokenAddress (contract) for non-native asset ${movement.asset} in transaction ${transactionId}`
        )
      );
    }

    // NEP-141 token with contract address
    return buildBlockchainTokenAssetId('near', movement.tokenAddress);
  }
}
