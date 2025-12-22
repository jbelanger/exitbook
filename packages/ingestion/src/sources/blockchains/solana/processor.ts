import type { SolanaTransaction } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, parseDecimal } from '@exitbook/core';
import { type Result, err, ok, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { looksLikeContractAddress, isMissingMetadata } from '../../../features/token-metadata/token-metadata-utils.js';
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

  constructor(tokenMetadataService: ITokenMetadataService) {
    super('solana', tokenMetadataService);
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

        // Fix Issue #78: Record fees when the user paid them and they aren't already accounted for
        // within remaining SOL outflows. When the fee fully consumes the SOL movement (fee-only
        // transactions), we still need an explicit fee entry to avoid undercounting balances.
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

        // Convert to ProcessedTransaction with structured fields
        const universalTransaction: ProcessedTransaction = {
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'solana',
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
                    assetSymbol: normalizedTx.feeCurrency || 'SOL',
                    amount: parseDecimal(normalizedTx.feeAmount || '0'),
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: classification.operation,

          notes: classification.notes,

          blockchain: {
            name: 'solana',
            block_height: normalizedTx.blockHeight || normalizedTx.slot,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },
        };

        // Scam detection: Check all movements (both inflows and outflows)
        const allMovements = [...fundFlow.inflows, ...fundFlow.outflows];
        for (const movement of allMovements) {
          const scamNote = await this.detectScamForAsset(movement.asset, movement.tokenAddress, {
            amount: parseDecimal(movement.amount).toNumber(),
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
        processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
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
   * Enrich token metadata for all transactions
   * Only fetches metadata for symbols that look like mint addresses
   */
  private async enrichTokenMetadata(transactions: SolanaTransaction[]): Promise<Result<void, Error>> {
    // Collect all token changes that need enrichment
    const tokenChangesToEnrich = transactions.flatMap((tx) => {
      if (!tx.tokenChanges) return [];
      // Enrich if metadata is incomplete OR if symbol looks like a mint address (Solana = 32+ chars)
      return tx.tokenChanges.filter(
        (change) =>
          isMissingMetadata(change.symbol, change.decimals) ||
          (change.symbol ? looksLikeContractAddress(change.symbol, 32) : false)
      );
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
