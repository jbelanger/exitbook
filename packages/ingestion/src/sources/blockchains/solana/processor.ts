import { type SolanaTransaction, SolanaTransactionSchema } from '@exitbook/blockchain-providers';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  parseDecimal,
  type Currency,
  type TokenMetadataRecord,
} from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { type Result, err, ok, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import type { ProcessedTransaction, AddressContext } from '../../../shared/types/processors.js';

import { analyzeSolanaFundFlow, classifySolanaOperationFromFundFlow } from './processor-utils.js';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into ProcessedTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class SolanaTransactionProcessor extends BaseTransactionProcessor<SolanaTransaction> {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;

  constructor(tokenMetadataService: ITokenMetadataService, scamDetectionService?: IScamDetectionService) {
    super('solana', tokenMetadataService, scamDetectionService);
  }

  protected get inputSchema() {
    return SolanaTransactionSchema;
  }

  /**
   * Process normalized data (structured SolanaTransaction objects)
   * with sophisticated fund flow analysis
   */
  protected async transformNormalizedData(
    normalizedData: SolanaTransaction[],
    context: AddressContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Enrich all transactions with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; signature: string }[] = [];
    const tokenMovementsForScamDetection: MovementWithContext[] = [];

    for (const normalizedTx of normalizedData) {
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
        const classification = classifySolanaOperationFromFundFlow(fundFlow, normalizedTx.instructions);

        // Determine when to record an explicit fee entry.
        // When feeAbsorbedByMovement is true, the fee was deducted from movements to prevent double-counting.
        // If there are still SOL outflows remaining, the fee is implicitly included in those movements.
        // If all outflows were consumed by the fee (fee-only transaction), we MUST record an explicit fee entry.
        const feeAccountedInMovements =
          fundFlow.feeAbsorbedByMovement &&
          fundFlow.outflows.some((movement) => movement.asset === fundFlow.feeCurrency);

        const shouldRecordFeeEntry = fundFlow.feePaidByUser && !feeAccountedInMovements;

        // Build movements with assetId
        const inflowsResult = this.buildMovementsWithAssetId(fundFlow.inflows, normalizedTx.id);
        if (inflowsResult.isErr()) {
          processingErrors.push({ error: inflowsResult.error.message, signature: normalizedTx.id });
          this.logger.error(
            `${inflowsResult.error.message} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
          );
          continue;
        }

        const outflowsResult = this.buildMovementsWithAssetId(fundFlow.outflows, normalizedTx.id);
        if (outflowsResult.isErr()) {
          processingErrors.push({ error: outflowsResult.error.message, signature: normalizedTx.id });
          this.logger.error(
            `${outflowsResult.error.message} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`
          );
          continue;
        }

        const inflows = inflowsResult.value;
        const outflows = outflowsResult.value;

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
        const processedTransaction: ProcessedTransaction = {
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

        transactions.push(processedTransaction);

        this.logger.debug(
          `Successfully processed transaction ${processedTransaction.externalId} - Category: ${classification.operation.category}, Type: ${classification.operation.type}, Amount: ${fundFlow.primary.amount} ${fundFlow.primary.asset}`
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
      let detectionUsedMetadata = false;

      const metadataResult = await this.tokenMetadataService.getOrFetchBatch('solana', uniqueContracts);
      if (metadataResult.isOk()) {
        metadataMap = metadataResult.value;
        detectionUsedMetadata = true;
      } else {
        this.logger.warn(
          { error: metadataResult.error.message },
          'Metadata fetch failed for scam detection (falling back to symbol-only)'
        );
      }

      this.markScamTransactions(transactions, tokenMovementsForScamDetection, metadataMap);
      this.logger.debug(
        `Applied ${detectionUsedMetadata ? 'metadata' : 'symbol-only'} scam detection to ${transactions.length} transactions (${uniqueContracts.length} tokens)`
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
        this.buildProcessingFailureError(
          failedTransactions,
          totalInputTransactions,
          processingErrors.map((e) => ({ id: e.signature, error: e.error }))
        )
      );
    }

    return okAsync(transactions);
  }

  /**
   * Enrich token metadata for all token changes.
   * Fetches metadata upfront in batch to populate cache for later use (asset ID building, scam detection).
   */
  private async enrichTokenMetadata(transactions: SolanaTransaction[]): Promise<Result<void, Error>> {
    // We enrich ALL token changes upfront (not just those with missing metadata) because:
    // 1. Scam detection needs metadata for all tokens with contract addresses
    // 2. Batching all fetches upfront is more efficient than separate calls later
    const tokenChanges = transactions.flatMap((tx) => tx.tokenChanges?.filter((c) => !!c.mint) ?? []);

    return this.enrichWithTokenMetadata(
      tokenChanges,
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
  }

  /**
   * Build processed movements (with assetId resolved) for an array of raw Solana movements.
   * Returns err if any movement's assetId cannot be resolved.
   */
  private buildMovementsWithAssetId(
    movements: { amount: string; asset: string; tokenAddress?: string | undefined }[],
    transactionSignature: string
  ): Result<{ assetId: string; assetSymbol: Currency; grossAmount: Decimal; netAmount: Decimal }[], Error> {
    const result: { assetId: string; assetSymbol: Currency; grossAmount: Decimal; netAmount: Decimal }[] = [];
    for (const movement of movements) {
      const assetIdResult = this.buildSolanaAssetId(movement, transactionSignature);
      if (assetIdResult.isErr()) {
        return err(assetIdResult.error);
      }
      const amount = parseDecimal(movement.amount);
      result.push({
        assetId: assetIdResult.value,
        assetSymbol: movement.asset as Currency,
        grossAmount: amount,
        netAmount: amount,
      });
    }
    return ok(result);
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
