/**
 * NEAR V3 Transaction Processor
 *
 * Processes raw multi-stream NEAR data by:
 * 1. Loading raw data from 4 stream types (transactions, receipts, activities, ft-transfers)
 * 2. Grouping by transaction hash
 * 3. Two-hop correlation: receipts link to transactions via transaction_hash,
 *    activities/ft-transfers link to receipts via receipt_id
 * 4. Aggregating multiple receipts into one UniversalTransaction per parent hash
 * 5. Fail-fast on missing deltas or incomplete data
 *
 * V3 Two-Hop Correlation Architecture:
 * - Provider: Streams 4 discrete data types without correlation
 * - Importer: Saves all 4 types with transaction_type_hint
 * - Processor: Uses receipts as bridge (tx → receipts → activities/ft-transfers)
 * - Activities/FT-transfers without receipt_id are skipped (logged as warnings)
 */

import type { NearBalanceChangeV3, NearStreamEvent } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, type TokenMetadataRecord } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, errAsync, ok, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.js';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.js';

import {
  classifyOperation,
  consolidateByAsset,
  correlateTransactionData,
  deriveBalanceChangeDeltasFromAbsolutes,
  extractReceiptFees,
  extractFlows,
  groupNearEventsByTransaction,
  isFeeOnlyFromOutflows,
  isFeeOnlyTransaction,
  validateTransactionGroup,
  type Movement,
} from './processor-utils.v3.js';
import type { CorrelatedTransaction } from './types.v3.js';

/**
 * NEAR V3 transaction processor that converts raw multi-stream data
 * into ProcessedTransaction format.
 *
 * Implements one-transaction-per-parent-hash architecture with receipt correlation.
 */
export class NearTransactionProcessorV3 extends BaseTransactionProcessor {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;

  constructor(tokenMetadataService: ITokenMetadataService, scamDetectionService?: IScamDetectionService) {
    super('near', tokenMetadataService, scamDetectionService);
  }

  /**
   * Process normalized data (raw stream events grouped by transaction hash)
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // STEP 1: Derive missing balance deltas from absolute amounts
    // This is the SINGLE SOURCE OF TRUTH for delta computation.
    // NearBlocks doesn't always provide deltaAmountYocto, so we derive it by:
    // - Grouping balance changes by account
    // - Sorting chronologically
    // - Computing delta = currentAbsolute - previousAbsolute
    const balanceChanges = normalizedData.filter(
      (event): event is NearBalanceChangeV3 => (event as NearStreamEvent).streamType === 'balance-changes'
    );

    // Create enriched data with derived deltas (immutable - no mutation)
    let enrichedNormalizedData = normalizedData;

    if (balanceChanges.length > 0) {
      const derivedResult = deriveBalanceChangeDeltasFromAbsolutes(balanceChanges);

      if (derivedResult.derivedDeltas.size > 0) {
        // Create new enriched objects instead of mutating
        enrichedNormalizedData = normalizedData.map((event) => {
          if ((event as NearStreamEvent).streamType === 'balance-changes') {
            const change = event as NearBalanceChangeV3;
            if (!change.deltaAmountYocto) {
              const derivedDelta = derivedResult.derivedDeltas.get(change.eventId);
              if (derivedDelta) {
                return { ...change, deltaAmountYocto: derivedDelta };
              }
            }
          }
          return event;
        });

        this.logger.info(`Derived ${derivedResult.derivedDeltas.size} missing NEAR balance deltas from absolutes`);
      }

      if (derivedResult.warnings.length > 0) {
        this.logger.warn(
          `NEAR balance delta derivation encountered ${derivedResult.warnings.length} warning(s). ` +
            `These represent assumptions or missing data that may affect financial accuracy. ` +
            `Review all warnings below:`
        );
        for (const warning of derivedResult.warnings) {
          this.logger.warn(`  - ${warning}`);
        }
      }
    }

    // Enrich token metadata upfront for all ft-transfers
    const enrichResult = await this.enrichTokenMetadata(enrichedNormalizedData as NearStreamEvent[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    // Group enriched normalized data by transaction hash
    const transactionGroups = groupNearEventsByTransaction(
      enrichedNormalizedData.map((item) => {
        const event = item as NearStreamEvent;
        return {
          blockchainTransactionHash: event.id,
          transactionTypeHint: event.streamType,
          normalizedData: event,
        };
      })
    );

    this.logger.debug(
      `Grouped ${enrichedNormalizedData.length} raw events into ${transactionGroups.size} transaction groups`
    );

    const transactions: ProcessedTransaction[] = [];
    const processingErrors: { error: string; txHash: string }[] = [];
    const tokenMovementsForScamDetection: MovementWithContext[] = [];

    for (const [txHash, group] of transactionGroups) {
      try {
        // Validate group has required data
        const validationResult = validateTransactionGroup(txHash, group);
        if (validationResult.isErr()) {
          const errorMsg = `Validation failed: ${validationResult.error.message}`;
          processingErrors.push({ error: errorMsg, txHash });
          this.logger.error(`${errorMsg} for NEAR transaction ${txHash} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        // Correlate receipts with activities and ft-transfers
        const correlationResult = correlateTransactionData(group);
        if (correlationResult.isErr()) {
          const errorMsg = `Correlation failed: ${correlationResult.error.message}`;
          processingErrors.push({ error: errorMsg, txHash });
          this.logger.error(`${errorMsg} for NEAR transaction ${txHash} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        const correlated = correlationResult.value;

        // Aggregate receipts to single transaction
        const aggregationResult = await this.aggregateToUniversalTransaction(
          correlated,
          context,
          tokenMovementsForScamDetection,
          transactions.length
        );

        if (aggregationResult.isErr()) {
          const errorMsg = `Aggregation failed: ${aggregationResult.error.message}`;
          processingErrors.push({ error: errorMsg, txHash });
          this.logger.error(`${errorMsg} for NEAR transaction ${txHash} - THIS TRANSACTION WILL BE LOST`);
          continue;
        }

        transactions.push(aggregationResult.value);

        this.logger.debug(
          `Successfully processed NEAR transaction ${txHash} with ${correlated.receipts.length} receipts`
        );
      } catch (error) {
        const errorMsg = `Unexpected error processing transaction: ${String(error)}`;
        processingErrors.push({ error: errorMsg, txHash });
        this.logger.error(`${errorMsg} for ${txHash} - THIS TRANSACTION WILL BE LOST`);
        continue;
      }
    }

    // Batch scam detection for token movements
    if (tokenMovementsForScamDetection.length > 0) {
      await this.performScamDetection(transactions, tokenMovementsForScamDetection);
    }

    // Fail-fast if any transactions could not be processed
    if (processingErrors.length > 0) {
      const totalInput = transactionGroups.size;
      const failed = processingErrors.length;

      this.logger.error(
        `CRITICAL PROCESSING FAILURE for NEAR:\n${processingErrors
          .map((e, i) => `  ${i + 1}. [${e.txHash.substring(0, 10)}...] ${e.error}`)
          .join('\n')}`
      );

      return err(
        `Cannot proceed: ${failed}/${totalInput} transactions failed to process. ` +
          `Lost ${failed} transactions which would corrupt portfolio calculations. ` +
          `Errors: ${processingErrors.map((e) => `[${e.txHash.substring(0, 10)}...]: ${e.error}`).join('; ')}`
      );
    }

    return ok(transactions);
  }

  /**
   * Aggregate correlated transaction data into a single ProcessedTransaction
   *
   * Combines all receipts, extracts fees and flows, consolidates by asset,
   * and builds the final transaction structure.
   */
  private async aggregateToUniversalTransaction(
    correlated: CorrelatedTransaction,
    context: ProcessingContext,
    tokenMovementsForScamDetection: MovementWithContext[],
    transactionIndex: number
  ): Promise<Result<ProcessedTransaction, Error>> {
    const hasTokenTransfers = correlated.receipts.some((receipt) => (receipt.tokenTransfers ?? []).length > 0);
    const hasActionDeposits = correlated.receipts.some((receipt) =>
      (receipt.actions ?? []).some((action) => {
        if (!action.deposit) return false;
        try {
          return new Decimal(action.deposit).greaterThan(0);
        } catch {
          return false;
        }
      })
    );
    const allInflows: Movement[] = [];
    const allOutflows: Movement[] = [];
    const allFees: Movement[] = [];
    let receiptFeeBurntTotal = new Decimal(0);

    // Extract flows from all receipts
    for (const receipt of correlated.receipts) {
      // Extract fees with conflict detection
      const feeResult = extractReceiptFees(receipt, context.primaryAddress);
      allFees.push(...feeResult.movements);
      if (feeResult.source === 'receipt' && feeResult.movements.length > 0) {
        for (const fee of feeResult.movements) {
          if (fee.asset === 'NEAR') {
            receiptFeeBurntTotal = receiptFeeBurntTotal.plus(fee.amount);
          }
        }
      }

      // Log warning if fee sources conflict
      if (feeResult.warning) {
        this.logger.warn(feeResult.warning);
      }

      // Extract flows
      const flows = extractFlows(receipt, context.primaryAddress);
      for (const flow of flows) {
        if (flow.direction === 'in') {
          allInflows.push(flow);
        } else {
          allOutflows.push(flow);
        }
      }
    }

    // Consolidate by asset
    const consolidatedInflows = Array.from(consolidateByAsset(allInflows).values());
    let consolidatedOutflows = Array.from(consolidateByAsset(allOutflows).values());
    const consolidatedFees = Array.from(consolidateByAsset(allFees).values());

    if (receiptFeeBurntTotal.greaterThan(0)) {
      const nearOutflow = consolidatedOutflows.find(
        (movement) => movement.asset === 'NEAR' && movement.contractAddress === undefined
      );
      if (nearOutflow) {
        if (nearOutflow.amount.greaterThan(receiptFeeBurntTotal)) {
          nearOutflow.amount = nearOutflow.amount.minus(receiptFeeBurntTotal);
        } else {
          if (!nearOutflow.amount.equals(receiptFeeBurntTotal)) {
            this.logger.warn(
              `Receipt fee total exceeds NEAR outflow for tx ${correlated.transaction.transactionHash}. ` +
                `Outflow=${nearOutflow.amount.toFixed()}, Fee=${receiptFeeBurntTotal.toFixed()}. ` +
                `Clamping outflow to 0 to avoid negative balance impact.`
            );
          }
          nearOutflow.amount = new Decimal(0);
        }
      }

      consolidatedOutflows = consolidatedOutflows.filter((movement) => !movement.amount.isZero());
    }

    const isFeeOnlyCandidate = isFeeOnlyTransaction(
      consolidatedInflows,
      consolidatedOutflows,
      consolidatedFees,
      hasTokenTransfers,
      hasActionDeposits
    );

    // Build assetIds for movements
    const inflowMovements = [];
    for (const inflow of consolidatedInflows) {
      const assetIdResult = await this.buildNearAssetId(inflow, correlated.transaction.transactionHash);
      if (assetIdResult.isErr()) {
        return err(new Error(`Failed to build assetId for inflow: ${assetIdResult.error.message}`));
      }

      inflowMovements.push({
        assetId: assetIdResult.value,
        assetSymbol: inflow.asset,
        grossAmount: inflow.amount,
        netAmount: inflow.amount,
      });

      // Collect for scam detection
      if (inflow.contractAddress) {
        tokenMovementsForScamDetection.push({
          contractAddress: inflow.contractAddress,
          asset: inflow.asset,
          amount: inflow.amount,
          isAirdrop: consolidatedOutflows.length === 0 && consolidatedFees.length === 0,
          transactionIndex,
        });
      }
    }

    let outflowMovements = [];
    for (const outflow of consolidatedOutflows) {
      const assetIdResult = await this.buildNearAssetId(outflow, correlated.transaction.transactionHash);
      if (assetIdResult.isErr()) {
        return err(new Error(`Failed to build assetId for outflow: ${assetIdResult.error.message}`));
      }

      outflowMovements.push({
        assetId: assetIdResult.value,
        assetSymbol: outflow.asset,
        grossAmount: outflow.amount,
        netAmount: outflow.amount,
      });

      // Collect for scam detection
      if (outflow.contractAddress) {
        tokenMovementsForScamDetection.push({
          contractAddress: outflow.contractAddress,
          asset: outflow.asset,
          amount: outflow.amount,
          isAirdrop: false,
          transactionIndex,
        });
      }
    }

    // Build fee assetId (always NEAR)
    const feeAssetIdResult = buildBlockchainNativeAssetId('near');
    if (feeAssetIdResult.isErr()) {
      return err(new Error(`Failed to build fee assetId: ${feeAssetIdResult.error.message}`));
    }

    let feeMovements = consolidatedFees.map((fee) => ({
      assetId: feeAssetIdResult.value,
      assetSymbol: 'NEAR',
      amount: fee.amount,
      scope: 'network' as const,
      settlement: 'balance' as const,
    }));

    if (isFeeOnlyFromOutflows(consolidatedInflows, consolidatedOutflows, hasTokenTransfers, hasActionDeposits)) {
      const outflowTotal = consolidatedOutflows.reduce((sum, movement) => sum.plus(movement.amount), new Decimal(0));
      const feeTotal = consolidatedFees.reduce((sum, movement) => sum.plus(movement.amount), new Decimal(0));
      const totalFee = outflowTotal.plus(feeTotal);
      feeMovements = totalFee.isZero()
        ? []
        : [
            {
              assetId: feeAssetIdResult.value,
              assetSymbol: 'NEAR',
              amount: totalFee,
              scope: 'network' as const,
              settlement: 'balance' as const,
            },
          ];
      outflowMovements = [];
    }

    // Classify operation
    const classification = isFeeOnlyCandidate
      ? { category: 'fee' as const, type: 'fee' as const }
      : classifyOperation(correlated, allInflows, allOutflows);

    // Determine from/to addresses
    let from: string | undefined;
    let to: string | undefined;

    if (consolidatedOutflows.length > 0) {
      from = correlated.transaction.signerAccountId;
    }
    if (consolidatedInflows.length > 0) {
      to = correlated.transaction.receiverAccountId;
    }

    // Build transaction timestamp (V3 blockTimestamp is already in milliseconds)
    const timestamp = correlated.transaction.blockTimestamp;

    const transaction: ProcessedTransaction = {
      externalId: correlated.transaction.transactionHash,
      datetime: new Date(timestamp).toISOString(),
      timestamp,
      source: 'near',
      status: correlated.transaction.status ? 'success' : 'failed',
      from,
      to,

      movements: {
        inflows: inflowMovements,
        outflows: outflowMovements,
      },

      fees: feeMovements,

      operation: {
        category: classification.category,
        type: classification.type,
      },

      blockchain: {
        name: 'near',
        block_height: correlated.transaction.blockHeight,
        transaction_hash: correlated.transaction.transactionHash,
        is_confirmed: correlated.transaction.status || false,
      },
    };

    return ok(transaction);
  }

  /**
   * Enrich token metadata for all FT transfers upfront
   */
  private async enrichTokenMetadata(events: NearStreamEvent[]): Promise<Result<void, Error>> {
    // Collect all FT transfer events
    const ftTransferEvents = events.filter((e) => e.streamType === 'token-transfers');

    if (ftTransferEvents.length === 0) {
      return ok(undefined);
    }

    this.logger.debug(`Enriching token metadata for ${ftTransferEvents.length} FT transfers`);

    // Extract contract addresses from V3 normalized types
    const contractAddresses = ftTransferEvents
      .map((e) => {
        if (e.streamType === 'token-transfers') {
          return e.contractAddress;
        }
        return;
      })
      .filter((addr): addr is string => !!addr);

    if (contractAddresses.length === 0) {
      return ok(undefined);
    }

    // Use token metadata service to enrich V3 normalized types
    const enrichResult = await this.tokenMetadataService.enrichBatch(
      ftTransferEvents,
      'near',
      (event) => {
        if (event.streamType === 'token-transfers') {
          return event.contractAddress;
        }
        return;
      },
      (event, metadata) => {
        if (event.streamType === 'token-transfers') {
          if (metadata.symbol) {
            event.symbol = metadata.symbol;
          }
          if (metadata.decimals !== undefined) {
            event.decimals = metadata.decimals;
          }
        }
      },
      (event) => {
        if (event.streamType === 'token-transfers') {
          return event.decimals !== undefined; // OK if decimals already present
        }
        return true;
      }
    );

    if (enrichResult.isErr()) {
      return err(new Error(`Failed to enrich token metadata: ${enrichResult.error.message}`));
    }

    this.logger.debug('Successfully enriched token metadata');
    return ok(undefined);
  }

  /**
   * Build assetId for a NEAR movement
   */
  private async buildNearAssetId(movement: Movement, transactionId: string): Promise<Result<string, Error>> {
    // Native asset (NEAR)
    if (!movement.contractAddress) {
      const assetSymbol = movement.asset.trim().toUpperCase();

      if (assetSymbol === 'NEAR') {
        return buildBlockchainNativeAssetId('near');
      }

      // Non-NEAR asset without contract address is an error
      return errAsync(
        new Error(`Missing contract address for non-native asset ${movement.asset} in transaction ${transactionId}`)
      );
    }

    // Token with contract address
    return buildBlockchainTokenAssetId('near', movement.contractAddress);
  }

  /**
   * Perform batch scam detection on token movements
   */
  private async performScamDetection(
    transactions: ProcessedTransaction[],
    tokenMovementsForScamDetection: MovementWithContext[]
  ): Promise<void> {
    if (!this.scamDetectionService || tokenMovementsForScamDetection.length === 0) {
      return;
    }

    const uniqueContracts = Array.from(new Set(tokenMovementsForScamDetection.map((m) => m.contractAddress)));
    let metadataMap = new Map<string, TokenMetadataRecord | undefined>();
    let detectionMode: 'metadata' | 'symbol-only' = 'symbol-only';

    if (this.tokenMetadataService && uniqueContracts.length > 0) {
      const metadataResult = await this.tokenMetadataService.getOrFetchBatch('near', uniqueContracts);

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
}
