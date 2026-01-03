/**
 * NEAR Transaction Processor
 *
 * Processing steps:
 * 1. Load raw data from 4 stream types (transactions, receipts, balance-changes, token-transfers)
 * 2. Group by transaction hash
 * 3. Two-hop correlation: receipts → transactions, balance changes → receipts
 * 4. Aggregate multiple receipts into one UniversalTransaction per parent hash
 * 5. Fail-fast on missing deltas or incomplete data
 */

import type { NearBalanceChange, NearStreamEvent } from '@exitbook/blockchain-providers';
import { buildBlockchainNativeAssetId, buildBlockchainTokenAssetId, type TokenMetadataRecord } from '@exitbook/core';
import type { IRawDataRepository } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { err, errAsync, ok, type Result } from 'neverthrow';

import { BaseTransactionProcessor } from '../../../features/process/base-transaction-processor.ts';
import type {
  IScamDetectionService,
  MovementWithContext,
} from '../../../features/scam-detection/scam-detection-service.interface.ts';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.ts';
import type { ProcessedTransaction, ProcessingContext } from '../../../shared/types/processors.ts';

import {
  classifyOperation,
  consolidateByAsset,
  correlateTransactionData,
  deriveBalanceChangeDeltasFromAbsolutes,
  extractReceiptFees,
  extractTokenTransferFlows,
  extractFlows,
  groupNearEventsByTransaction,
  isFeeOnlyFromOutflows,
  isFeeOnlyTransaction,
  validateTransactionGroup,
  type Movement,
} from './processor-utils.ts';
import type { CorrelatedTransaction } from './types.js';

/**
 * NEAR transaction processor that converts raw multi-stream data
 * into ProcessedTransaction format
 */
export class NearTransactionProcessor extends BaseTransactionProcessor {
  // Override to make tokenMetadataService required (guaranteed by factory)
  declare protected readonly tokenMetadataService: ITokenMetadataService;

  constructor(
    tokenMetadataService: ITokenMetadataService,
    scamDetectionService?: IScamDetectionService,
    private readonly rawDataRepository?: IRawDataRepository,
    private readonly accountId?: number | undefined
  ) {
    super('near', tokenMetadataService, scamDetectionService);
  }

  /**
   * Process normalized data
   */
  protected async processInternal(
    normalizedData: unknown[],
    context: ProcessingContext
  ): Promise<Result<ProcessedTransaction[], string>> {
    // Derive missing balance deltas from absolute amounts
    // Single source of truth for delta computation
    const balanceChanges = normalizedData.filter(
      (event): event is NearBalanceChange => (event as NearStreamEvent).streamType === 'balance-changes'
    );

    // Create enriched data with derived deltas (immutable - no mutation)
    let enrichedNormalizedData = normalizedData;

    if (balanceChanges.length > 0) {
      const missingDeltas = balanceChanges.some((change) => !change.deltaAmountYocto);
      let previousBalances = new Map<string, string>();

      if (missingDeltas) {
        const previousResult = await this.loadPreviousBalances(balanceChanges);
        if (previousResult.isErr()) {
          return err(previousResult.error);
        }
        previousBalances = previousResult.value;
      }

      const derivedResult = deriveBalanceChangeDeltasFromAbsolutes(balanceChanges, previousBalances);

      if (derivedResult.derivedDeltas.size > 0) {
        enrichedNormalizedData = normalizedData.map((event) => {
          if ((event as NearStreamEvent).streamType === 'balance-changes') {
            const change = event as NearBalanceChange;
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

    // Enrich token metadata for all token transfers
    const enrichResult = await this.enrichTokenMetadata(enrichedNormalizedData as NearStreamEvent[]);
    if (enrichResult.isErr()) {
      return err(`Token metadata enrichment failed: ${enrichResult.error.message}`);
    }

    // Group enriched normalized data by transaction hash
    const groupingResult = groupNearEventsByTransaction(enrichedNormalizedData as NearStreamEvent[]);
    if (groupingResult.isErr()) {
      return err(`Failed to group transaction data: ${groupingResult.error.message}`);
    }
    const transactionGroups = groupingResult.value;

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

    // Batch scam detection
    if (tokenMovementsForScamDetection.length > 0) {
      await this.performScamDetection(transactions, tokenMovementsForScamDetection);
    }

    // Fail-fast if processing errors occurred
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

  private async loadPreviousBalances(
    balanceChanges: NearBalanceChange[]
  ): Promise<Result<Map<string, string>, string>> {
    if (!this.rawDataRepository || this.accountId === undefined) {
      this.logger.warn(
        'NEAR processor missing rawDataRepository/accountId. Proceeding without previous balance lookup.'
      );
      return ok(new Map());
    }

    const earliestByAccount = new Map<string, NearBalanceChange>();
    for (const change of balanceChanges) {
      const existing = earliestByAccount.get(change.affectedAccountId);
      if (!existing || this.compareBalanceChanges(change, existing) < 0) {
        earliestByAccount.set(change.affectedAccountId, change);
      }
    }

    if (earliestByAccount.size === 0) {
      return ok(new Map());
    }

    let maxTimestamp = 0;
    for (const change of earliestByAccount.values()) {
      if (change.timestamp > maxTimestamp) {
        maxTimestamp = change.timestamp;
      }
    }

    const affectedAccounts = Array.from(earliestByAccount.keys());
    const processedResult = await this.rawDataRepository.loadProcessedNearBalanceChangesByAccounts(
      this.accountId,
      affectedAccounts,
      maxTimestamp
    );

    if (processedResult.isErr()) {
      return err(`Failed to load previous NEAR balances: ${processedResult.error.message}`);
    }

    const processedByAccount = new Map<string, NearBalanceChange[]>();
    for (const row of processedResult.value) {
      const change = row.normalizedData as NearBalanceChange;
      if (!change?.affectedAccountId || !change.absoluteNonstakedAmount) {
        this.logger.warn(
          { eventId: row.eventId, accountId: row.accountId },
          'Skipping malformed processed balance change when deriving previous balances'
        );
        continue;
      }

      const existing = processedByAccount.get(change.affectedAccountId) || [];
      existing.push(change);
      processedByAccount.set(change.affectedAccountId, existing);
    }

    const previousBalances = new Map<string, string>();
    for (const [accountId, earliest] of earliestByAccount.entries()) {
      const candidates = processedByAccount.get(accountId);
      if (!candidates || candidates.length === 0) {
        continue;
      }

      let latest: NearBalanceChange | undefined;
      for (const candidate of candidates) {
        if (this.compareBalanceChanges(candidate, earliest) >= 0) {
          continue;
        }
        if (!latest || this.compareBalanceChanges(candidate, latest) > 0) {
          latest = candidate;
        }
      }

      if (latest) {
        previousBalances.set(accountId, latest.absoluteNonstakedAmount);
      }
    }

    return ok(previousBalances);
  }

  private compareBalanceChanges(a: NearBalanceChange, b: NearBalanceChange): number {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    const heightA = this.parseBlockHeight(a.blockHeight);
    const heightB = this.parseBlockHeight(b.blockHeight);
    if (heightA !== heightB) {
      return heightA - heightB;
    }
    const hasReceiptA = a.receiptId !== undefined && a.receiptId !== null;
    const hasReceiptB = b.receiptId !== undefined && b.receiptId !== null;
    if (hasReceiptA !== hasReceiptB) {
      return hasReceiptA ? -1 : 1;
    }
    const receiptA = a.receiptId ?? '';
    const receiptB = b.receiptId ?? '';
    if (receiptA !== receiptB) {
      return receiptA.localeCompare(receiptB);
    }
    return (a.eventId ?? '').localeCompare(b.eventId ?? '');
  }

  private parseBlockHeight(blockHeight: string | undefined): number {
    if (!blockHeight) return 0;
    const parsed = Number.parseInt(blockHeight, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Aggregate correlated transaction data into a single ProcessedTransaction
   */
  private async aggregateToUniversalTransaction(
    correlated: CorrelatedTransaction,
    context: ProcessingContext,
    tokenMovementsForScamDetection: MovementWithContext[],
    transactionIndex: number
  ): Promise<Result<ProcessedTransaction, Error>> {
    const tokenTransferFlows = extractTokenTransferFlows(correlated.tokenTransfers, context.primaryAddress);
    const hasTokenTransfers = correlated.tokenTransfers.length > 0 || tokenTransferFlows.length > 0;
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
      // Extract fees
      const feeResult = extractReceiptFees(receipt, context.primaryAddress);
      allFees.push(...feeResult.movements);
      if (feeResult.source === 'receipt' && feeResult.movements.length > 0) {
        for (const fee of feeResult.movements) {
          if (fee.asset === 'NEAR') {
            receiptFeeBurntTotal = receiptFeeBurntTotal.plus(fee.amount);
          }
        }
      }

      // Log fee conflict warnings
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

    // Extract token transfer flows
    for (const flow of tokenTransferFlows) {
      if (flow.direction === 'in') {
        allInflows.push(flow);
      } else {
        allOutflows.push(flow);
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

    // Build assetIds
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

    // Build fee assetId
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

    // Build transaction timestamp
    const timestamp = correlated.transaction.timestamp;

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
   * Enrich token metadata for token transfers
   */
  private async enrichTokenMetadata(events: NearStreamEvent[]): Promise<Result<void, Error>> {
    // Collect token transfer events
    const ftTransferEvents = events.filter((e) => e.streamType === 'token-transfers');

    if (ftTransferEvents.length === 0) {
      return ok(undefined);
    }

    this.logger.debug(`Enriching token metadata for ${ftTransferEvents.length} FT transfers`);

    // Extract contract addresses
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

    // Enrich with token metadata service
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
          return event.decimals !== undefined;
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
    // Native asset
    if (!movement.contractAddress) {
      const assetSymbol = movement.asset.trim().toUpperCase();

      if (assetSymbol === 'NEAR') {
        return buildBlockchainNativeAssetId('near');
      }

      // Non-NEAR asset without contract address
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
