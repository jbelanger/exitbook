import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { SolanaTransaction } from '@exitbook/providers';
import { type Result, err, ok, okAsync } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { looksLikeContractAddress, isMissingMetadata } from '../../../services/token-metadata/token-metadata-utils.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import { analyzeSolanaFundFlow, classifySolanaOperationFromFundFlow } from './processor-utils.js';

/**
 * Solana transaction processor that converts raw blockchain transaction data
 * into UniversalTransaction format. Features sophisticated fund flow analysis
 * and historical context for accurate transaction classification.
 */
export class SolanaTransactionProcessor extends BaseTransactionProcessor {
  constructor(
    private readonly tokenMetadataService: ITokenMetadataService,
    private readonly _transactionRepository?: ITransactionRepository
  ) {
    super('solana');
  }

  /**
   * Process normalized data (structured SolanaTransaction objects)
   * with sophisticated fund flow analysis
   */
  protected async processInternal(
    normalizedData: unknown[],
    sessionMetadata?: Record<string, unknown>
  ): Promise<Result<UniversalTransaction[], string>> {
    if (!sessionMetadata) {
      return err('Missing session metadata for normalized processing');
    }

    this.logger.info(`Processing ${normalizedData.length} normalized Solana transactions`);

    // Enrich all transactions with token metadata (required)
    const enrichResult = await this.enrichTokenMetadata(normalizedData as SolanaTransaction[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    const transactions: UniversalTransaction[] = [];
    const processingErrors: { error: string; signature: string }[] = [];

    for (const item of normalizedData) {
      const normalizedTx = item as SolanaTransaction;

      try {
        // Perform enhanced fund flow analysis
        const fundFlowResult = analyzeSolanaFundFlow(normalizedTx, sessionMetadata);

        if (fundFlowResult.isErr()) {
          const errorMsg = `Fund flow analysis failed: ${fundFlowResult.error}`;
          processingErrors.push({ error: errorMsg, signature: normalizedTx.id });
          this.logger.error(`${errorMsg} for Solana transaction ${normalizedTx.id} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const fundFlow = fundFlowResult.value;

        // Determine transaction type and operation classification based on fund flow
        const classification = classifySolanaOperationFromFundFlow(fundFlow, normalizedTx.instructions || []);

        // Only include fees if user was the signer/broadcaster (they paid the fee)
        // For incoming transactions (deposits, airdrops, received transfers), the sender/protocol paid the fee
        // User paid fee if:
        // 1. They have ANY outflows (sent funds, swapped, staked, etc.) OR
        // 2. They initiated a transaction with no outflows (contract interactions, approvals, account creation)
        // Note: Solana addresses are case-sensitive (base58), so we compare them directly
        const userAddress = sessionMetadata.address as string;
        const userPaidFee = fundFlow.outflows.length > 0 || normalizedTx.from === userAddress;

        // Convert to UniversalTransaction with structured fields
        const universalTransaction: UniversalTransaction = {
          id: 0, // Will be assigned by database
          externalId: normalizedTx.id,
          datetime: new Date(normalizedTx.timestamp).toISOString(),
          timestamp: normalizedTx.timestamp,
          source: 'solana',
          status: normalizedTx.status,
          from: fundFlow.fromAddress,
          to: fundFlow.toAddress,

          // Structured movements from fund flow analysis
          movements: {
            inflows: fundFlow.inflows.map((inflow) => {
              const amount = parseDecimal(inflow.amount);
              return {
                asset: inflow.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
            outflows: fundFlow.outflows.map((outflow) => {
              const amount = parseDecimal(outflow.amount);
              return {
                asset: outflow.asset,
                grossAmount: amount,
                netAmount: amount,
              };
            }),
          },

          fees:
            userPaidFee && !parseDecimal(normalizedTx.feeAmount || '0').isZero()
              ? [
                  {
                    asset: normalizedTx.feeCurrency || 'SOL',
                    amount: parseDecimal(normalizedTx.feeAmount || '0'),
                    scope: 'network',
                    settlement: 'balance',
                  },
                ]
              : [],

          operation: classification.operation,

          note: classification.note,

          blockchain: {
            name: 'solana',
            block_height: normalizedTx.blockHeight || normalizedTx.slot,
            transaction_hash: normalizedTx.id,
            is_confirmed: normalizedTx.status === 'success',
          },

          // Minimal metadata - only Solana-specific data
          metadata: {
            blockId: normalizedTx.blockId,
            computeUnitsUsed: fundFlow.computeUnitsUsed,
            hasMultipleInstructions: fundFlow.hasMultipleInstructions,
            hasStaking: fundFlow.hasStaking,
            hasSwaps: fundFlow.hasSwaps,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
            instructionCount: fundFlow.instructionCount,
            providerId: normalizedTx.providerId,
            signature: normalizedTx.signature,
            slot: normalizedTx.slot,
            tokenAddress: fundFlow.primary.tokenAddress,
            tokenDecimals: fundFlow.primary.decimals,
          },
        };

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
    const successfulTransactions = transactions.length;
    const failedTransactions = processingErrors.length;

    this.logger.info(
      `Processing completed for Solana: ${successfulTransactions} transactions processed, ${failedTransactions} failed (${failedTransactions}/${totalInputTransactions} transactions lost)`
    );

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
      return ok(void 0);
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
    return ok(void 0);
  }
}
