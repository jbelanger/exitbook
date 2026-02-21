import type { SolanaTransaction } from '@exitbook/blockchain-providers';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  parseDecimal,
  type Currency,
  type TokenMetadataRecord,
} from '@exitbook/core';
import { type Result, err, ok, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import { analyzeSolanaFundFlow, classifySolanaOperationFromFundFlow } from './processor-utils.js';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class SolanaTransactionProcessor extends BaseTransactionProcessor {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;

  constructor(tokenMetadataService: ITokenMetadataService, scamDetectionService?: IScamDetectionService) {
    super('solana', tokenMetadataService, scamDetectionService);
  }

  /**
   * Process normalized data (structured SolanaTransaction objects)
   * with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Enrich all transactions with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as SolanaTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; signature: string }[] = [];
    const tokenMovementsForScamDetection: MovementWithContext[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SolanaTransaction;

      try {
        // Perform enhanced fund flow analysis
        const fundFlowResult = analyzeSolanaFundFlow(normalizedTx, context);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
          this.logger.error(`${errorMsg} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type and operation classification based on fund flow
        const classification = classifySolanaOperationFromFundFlow(fundFlow, normalizedTx.instructions || []);

        // Fix Issue #78: Determine when to record an explicit fee entry
        // When feeAbsorbedByMovement is true, the fee was deducted from movements to prevent double-counting.
        // If there are still SOL outflows remaining, the fee is implicitly included in those movements.
        // If all outflows were consumed by the fee (fee-only transaction), we MUST record an explicit fee entry.
        const feeAccountedInMovements =
          fundFlow.feeAbsorbedByMovement &&
          fundFlow.outflows.some((movement) => movement.asset === (fundFlow.feeCurrency || 'SOL'));

        const shouldRecordFeeEntry = fundFlow.feePaidByUser && !feeAccountedInMovements;

        // Build movements with assetId
        let hasAssetIdError = false;
        const inflows = [];
        for (const inflow of fundFlow.inflows) {
          const assetIdResult = this.buildSolanaAssetId(inflow, normalizedTx.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for inflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
            this.logger.error(`${errorMsg} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
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
          const assetIdResult = this.buildSolanaAssetId(outflow, normalizedTx.id);
          if (assetIdResult.isErr()) {
            const errorMsg = `Failed to build assetId for outflow: ${assetIdResult.error.message}`;
            processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
            this.logger.error(`${errorMsg} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
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

        // Build fee assetId (always SOL for Solana)
        const feeAssetIdResult = buildBlockchainNativeAssetId('solana');
        if (feeAssetIdResult.isErr()) {
          const errorMsg = `Failed to build fee assetId: ${feeAssetIdResult.error.message}`;
          processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
          this.logger.error(`${errorMsg} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }
        const feeAssetId = feeAssetIdResult.value;

        const fees =
          shouldRecordFeeEntry && !parseDecimal(normalizedTx.feeAmount || '0').isZero()
            ? [
                {
                  assetId: feeAssetId,
                  assetSymbol: (normalizedTx.feeCurrency || 'SOL') as Currency,
                  amount: parseDecimal(normalizedTx.feeAmount || '0'),
                  scope: 'network' as const,
                  settlement: 'balance' as const,
                },
              ]
            : [];

        if (inflows.length === 0 && outflows.length === 0 && fees.length === 0) {
          this.logger.warn(
            {
              txId: normalizedTx.id,
              eventId: normalizedTx.eventId,
              feePayer: normalizedTx.feePayer,
              status: normalizedTx.status,
            },
            'Skipping Solana transaction with no movements and no fees'
          );
          continue;
        }

        // Convert to ProcessedTransaction with structured fields
        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'solana',
          sourceType: 'blockchain',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows,
            outflows,
          },

          fees,

          operation: classification.operation,

          notes: classification.notes,

          blockchain: {
            name: 'solana',
            block_height: normalizedTx.blockHeight || normalizedTx.slot,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
        };

        // Collect token movements for batch scam detection later
        const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
        const isAirdrop = fundFlow.outflows.length === 0 && !fundFlow.feePaidByUser;

        for (const movement of allMovements) {
          if (!movement.tokenAddress) {
            continue;
          }
          tokenMovementsForScamDetection.push({
            contractAddress: movement.tokenAddress,
            asset: movement.asset,
            amount: parseDecimal(movement.amount),
            isAirdrop,
            transactionIndex: transactions.length, // Index of transaction we're about to push
          });
        }

        transactions.push(universalTransaction);

        this.logger.debug(
          `Successfully processed transaction ${universalTransaction.externalId} - Category: ${classification.operation.category}, Type: ${classification.operation.type}, Amount: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
        );
      } catch (error) {
        const errorMsg = `Error processing normalized transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
        this.logger.error(`${errorMsg} for ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Batch scam detection: token movements only (skip native SOL)
    if (tokenMovementsForScamDetection.length > 0) {
      const uniqueContracts = Array.from(new Set(tokenMovementsForScamDetection.map((m) => m.contractAddress)));
      let metadataMap = new Map<string, TokenMetadataRecord | undefined>();
      let detectionMode: 'metadata' | 'symbol-only' = 'symbol-only';

      if (this.tokenMetadataService && uniqueContracts.length > 0) {
        const metadataResult = await this.tokenMetadataService.getOrFetchBatch('solana', uniqueContracts);

        if (metadataResult.isOk()) {
          metadataMap = metadataResult.value;
          detectionMode = 'metadata';
        } else {
          this.logger.warn(
            { error: metadataResult.error.message },
            'Metadata fetch failed for scam detection (falling back to symbol-only)'
          );
        }
      }

      this.applyScamDetection(transactions, tokenMovementsForScamDetection, metadataMap);
      this.logger.debug(
        `Applied ${detectionMode} scam detection to ${transactions.length} transactions (${uniqueContracts.length} tokens)`
      );
    }

    // Log processing summary
    const totalInputTransactions = normalizedData.length;
    const failedTransactions = processingErrors.length;

    // STRICT MODE: Fail if ANY transactions could not be processed
    // This is critical for portfolio accuracy - we cannot afford to silently drop transactions
    if (processingErrors.length > 0) {
      this.logger.error(
        `CRITICAL PROCESSING FAILURE for Solana:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.signature.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failedTransactions}/${totalInputTransactions} transactions failed to process. ` +
          `Lost ${failedTransactions} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.signature.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return okAsync(transactions);
  }

  /**
   * Enrich token metadata for all token changes.
   * Fetches metadata upfront in batch to populate cache for later use (asset ID building, scam detection).
   */
  private async enrichTokenMetadata(transactions: SolanaTransaction[]): Promise<Result<void, Error>> {
    // Collect all token changes with mint addresses for batch enrichment
    // We enrich ALL of them upfront (not just those with missing/incomplete metadata) because:
    // 1. Scam detection needs metadata for all tokens with contract addresses
    // 2. Batching all fetches upfront is more efficient than separate calls later
    const tokenChangesToEnrich = transactions.flatMap((tx) => {
      if (!tx.tokenChanges) return [];
      return tx.tokenChanges.filter((change) => !!change.mint);
    });

    if (tokenChangesToEnrich.length === 0) {
      return ok(undefined);
    }

    this.logger.debug(`Enriching token metadata for ${tokenChangesToEnrich.length} token changes`);

    // Use the token metadata service to enrich with caching and provider fetching
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      tokenChangesToEnrich,
      'solana',
      (change) => change.mint,
      (change, metadata) => {
        if (metadata.symbol) {
          change.symbol = metadata.symbol;
        }
        // Decimals are already set from provider data, but update if metadata has better info
        if (metadata.decimals !== undefined && metadata.decimals !== change.decimals) {
          this.logger.debug(`Updating decimals for ${change.mint} from ${change.decimals} to ${metadata.decimals}`);
          change.decimals = metadata.decimals;
        }
      },
      (change) => change.decimals !== undefined // Enrichment failure OK if decimals already present
    );

    if (enrichResult.isErr()) {
      return err(new Error(`Failed to enrich token metadata: ${enrichResult.error.message}`));
    }

    this.logger.debug('Successfully enriched token metadata from cache/provider');
    return ok(undefined);
  }

  /**
   * Build assetId for a Solana movement
   * - Native asset (SOL, no tokenAddress): blockchain:solana:native
   * - SPL token (has mint address): blockchain:solana:<mint_address>
   * - Token without mint address (edge case): fail-fast with an error
   *
   * Per Asset Identity Specification, tokenAddress (mint) should usually be available for SPL tokens.
   * If missing for a non-native asset, we fail-fast to prevent silent data corruption.
   */
  private buildSolanaAssetId(
    movement: {
      asset: string;
      tokenAddress?: string | undefined;
    },
    transactionSignature: string
  ): Result<string, Error> {
    // Native asset (SOL) - no mint address
    if (!movement.tokenAddress) {
      const assetSymbol = movement.asset.trim().toUpperCase();

      if (assetSymbol === 'SOL') {
        return buildBlockchainNativeAssetId('solana');
      }

      // If it's not SOL and has no mint address, this is an error
      return err(
        new Error(
          `Missing tokenAddress (mint) for non-native asset ${movement.asset} in transaction ${transactionSignature}`
        )
      );
    }

    // SPL token with mint address
    return buildBlockchainTokenAssetId('solana', movement.tokenAddress);
  }
}
