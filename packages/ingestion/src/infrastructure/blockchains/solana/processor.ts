import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { SolanaTransaction } from '@exitbook/providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/providers';
import { type Result, err, ok, okAsync } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { looksLikeContractAddress, isMissingMetadata } from '../../../services/token-metadata/token-metadata-utils.ts';
import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import {
  classifySolanaOperationFromFundFlow,
  consolidateSolanaMovements,
  detectSolanaStakingInstructions,
  detectSolanaSwapInstructions,
  detectSolanaTokenTransferInstructions,
} from './processor-utils.js';
import type { SolanaBalanceChangeAnalysis, SolanaFundFlow, SolanaMovement } from './types.js';

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
        const fundFlowResult = this.analyzeFundFlowFromNormalized(normalizedTx, sessionMetadata);

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
   * Analyze fund flow from normalized SolanaTransaction data
   */
  private analyzeFundFlowFromNormalized(
    tx: SolanaTransaction,
    sessionMetadata: Record<string, unknown>
  ): Result<SolanaFundFlow, string> {
    if (!sessionMetadata.address || typeof sessionMetadata.address !== 'string') {
      return err('Missing user address in session metadata');
    }

    const userAddress = sessionMetadata.address;
    const derivedAddresses = Array.isArray(sessionMetadata.derivedAddresses)
      ? sessionMetadata.derivedAddresses.filter((addr): addr is string => typeof addr === 'string')
      : [];
    const allWalletAddresses = new Set<string>([userAddress, ...derivedAddresses]);

    // Analyze instruction complexity
    const instructionCount = tx.instructions?.length || 0;
    const hasMultipleInstructions = instructionCount > 1;

    // Detect transaction types based on instructions
    const hasStaking = detectSolanaStakingInstructions(tx.instructions || []);
    const hasSwaps = detectSolanaSwapInstructions(tx.instructions || []);
    const hasTokenTransfers = detectSolanaTokenTransferInstructions(tx.instructions || []);

    // Enhanced fund flow analysis using balance changes
    const flowAnalysis = this.analyzeBalanceChanges(tx, allWalletAddresses);

    const fundFlow: SolanaFundFlow = {
      computeUnitsUsed: tx.computeUnitsConsumed,
      feeAmount: tx.feeAmount || '0',
      feeCurrency: tx.feeCurrency || 'SOL',
      feePaidByUser: flowAnalysis.feePaidByUser,
      fromAddress: flowAnalysis.fromAddress,
      toAddress: flowAnalysis.toAddress,
      hasMultipleInstructions,
      hasStaking,
      hasSwaps,
      hasTokenTransfers,
      instructionCount,
      transactionCount: 1, // Always 1 for Solana (no correlation like EVM)

      inflows: flowAnalysis.inflows,
      outflows: flowAnalysis.outflows,
      primary: flowAnalysis.primary,

      // Classification uncertainty
      classificationUncertainty: flowAnalysis.classificationUncertainty,
    };

    return ok(fundFlow);
  }

  /**
   * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
   */
  private analyzeBalanceChanges(tx: SolanaTransaction, allWalletAddresses: Set<string>): SolanaBalanceChangeAnalysis {
    const inflows: SolanaMovement[] = [];
    const outflows: SolanaMovement[] = [];
    let fromAddress = tx.from;
    let toAddress = tx.to;

    // Collect ALL token balance changes involving the user
    if (tx.tokenChanges && tx.tokenChanges.length > 0) {
      for (const change of tx.tokenChanges) {
        const isUserAccount =
          allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner));

        if (!isUserAccount) continue;

        const tokenAmountInSmallestUnits = parseFloat(change.postAmount) - parseFloat(change.preAmount);
        if (tokenAmountInSmallestUnits === 0) continue; // Skip zero changes

        // Normalize token amount using decimals metadata
        // All providers return amounts in smallest units; normalization ensures consistency and safety
        const normalizedAmount = normalizeTokenAmount(Math.abs(tokenAmountInSmallestUnits).toString(), change.decimals);

        const movement: SolanaMovement = {
          amount: normalizedAmount,
          asset: change.symbol || change.mint,
          decimals: change.decimals,
          tokenAddress: change.mint,
        };

        if (tokenAmountInSmallestUnits > 0) {
          inflows.push(movement);
          toAddress = change.account;
        } else {
          outflows.push(movement);
          fromAddress = change.account;
        }
      }
    }

    // Collect ALL SOL balance changes involving the user (excluding fee-only changes)
    if (tx.accountChanges && tx.accountChanges.length > 0) {
      for (const change of tx.accountChanges) {
        const isUserAccount = allWalletAddresses.has(change.account);
        if (!isUserAccount) continue;

        const solAmountInLamports = parseFloat(change.postBalance) - parseFloat(change.preBalance);
        if (solAmountInLamports === 0) continue; // Skip zero changes

        // Normalize lamports to SOL using native amount normalization (SOL has 9 decimals)
        const normalizedSolAmount = normalizeNativeAmount(Math.abs(solAmountInLamports).toString(), 9);
        const movement = {
          amount: normalizedSolAmount,
          asset: 'SOL',
        };

        if (solAmountInLamports > 0) {
          inflows.push(movement);
          toAddress = change.account;
        } else {
          outflows.push(movement);
          fromAddress = change.account;
        }
      }
    }

    const consolidatedInflows = consolidateSolanaMovements(inflows);
    const consolidatedOutflows = consolidateSolanaMovements(outflows);

    // Select primary asset for simplified consumption and single-asset display
    // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
    let primary: SolanaMovement = {
      amount: '0',
      asset: 'SOL',
    };

    // Use largest inflow as primary (prefer tokens with more decimals)
    const largestInflow = consolidatedInflows
      .sort((a, b) => {
        try {
          return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
        } catch {
          return 0;
        }
      })
      .find((inflow) => !this.isZero(inflow.amount));

    if (largestInflow) {
      primary = { ...largestInflow };
    } else {
      // If no inflows, use largest outflow
      const largestOutflow = consolidatedOutflows
        .sort((a, b) => {
          try {
            return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
          } catch {
            return 0;
          }
        })
        .find((outflow) => !this.isZero(outflow.amount));

      if (largestOutflow) {
        primary = { ...largestOutflow };
      }
    }

    // Track uncertainty for complex transactions
    let classificationUncertainty: string | undefined;
    if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
      classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
    }

    // Determine fee payer
    const feePaidByUser = allWalletAddresses.has(tx.from) || allWalletAddresses.has(fromAddress);

    return {
      classificationUncertainty,
      feePaidByUser,
      fromAddress,
      inflows: consolidatedInflows,
      outflows: consolidatedOutflows,
      primary,
      toAddress,
    };
  }

  private isZero(value: string): boolean {
    try {
      return parseDecimal(value || '0').isZero();
    } catch {
      return true;
    }
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
