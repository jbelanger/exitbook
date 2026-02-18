import { Currency, parseDecimal, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';
import { LinkIndex } from '../linking/link-index.js';
import type { TransactionLink } from '../linking/types.js';
import type { TransactionLinkQueries } from '../persistence/transaction-link-queries.js';

import {
  buildAcquisitionLotFromInflow,
  filterTransactionsWithoutPrices,
  matchOutflowDisposal,
  processTransferSource,
  processTransferTarget,
  sortTransactionsByDependency,
} from './lot-matcher-utils.js';
import type { ICostBasisStrategy } from './strategies/base-strategy.js';

/**
 * Configuration for lot matching
 */
export interface LotMatcherConfig {
  /** Calculation ID to associate lots with */
  calculationId: string;
  /** Cost basis strategy to use (FIFO, LIFO, etc.) */
  strategy: ICostBasisStrategy;
  /** Jurisdiction configuration for tax policy (required for transfer handling) */
  jurisdiction?:
    | {
        sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis';
      }
    | undefined;
  /** Optional variance tolerance override */
  varianceTolerance?: { error: number; warn: number } | undefined;
}

/**
 * Result of lot matching for a single asset
 */
export interface AssetLotMatchResult {
  /** Asset ID (contract-level identifier) */
  assetId: string;
  /** Asset symbol (display name) */
  assetSymbol: string;
  /** Acquisition lots created */
  lots: AcquisitionLot[];
  /** Disposals matched to lots */
  disposals: LotDisposal[];
  /** Lot transfers (for cross-transaction cost basis tracking) */
  lotTransfers: LotTransfer[];
}

/**
 * A per-asset error that did not abort the entire calculation.
 * The failed asset is excluded from results; other assets continue normally.
 */
export interface AssetMatchError {
  assetId: string;
  assetSymbol: string;
  error: string;
}

/**
 * Result of lot matching across all assets
 */
export interface LotMatchResult {
  /** Results grouped by asset */
  assetResults: AssetLotMatchResult[];
  /** Total number of acquisition lots created */
  totalLotsCreated: number;
  /** Total number of disposals processed */
  totalDisposalsProcessed: number;
  /** Total number of transfers processed */
  totalTransfersProcessed: number;
  /** Per-asset errors that didn't abort the entire calculation */
  errors: AssetMatchError[];
}

/**
 * Result of searching for an effective source link for an outflow.
 *
 * - transfer: Found a cross-source link (may have consumed internal links first)
 * - internal_only: Found only blockchain_internal links (outflow should be skipped)
 * - none: No links found (treat as regular disposal)
 */
type SourceLinkResult =
  | { isPartialOutflow: boolean; link: TransactionLink; type: 'transfer' }
  | { type: 'internal_only' }
  | { type: 'none' };

/**
 * Result of searching for an effective target link for an inflow.
 *
 * - transfer: Found a cross-source link (may have consumed internal links first)
 * - internal_only: Found only blockchain_internal links (inflow should be skipped)
 * - none: No links found (treat as regular acquisition)
 */
type TargetLinkResult = { link: TransactionLink; type: 'transfer' } | { type: 'internal_only' } | { type: 'none' };

/**
 * Mutable per-asset state used during the global transaction processing pass.
 */
interface AssetProcessingState {
  assetSymbol: string;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
}

/**
 * LotMatcher - Matches disposal transactions to acquisition lots using a specified strategy
 *
 * This service:
 * 1. Sorts transactions by dependency order (topological sort)
 * 2. Processes each transaction globally: outflows first, then inflows
 * 3. Creates acquisition lots, disposals, and lot transfers per asset
 * 4. Returns lots and disposals for storage
 *
 * Note: Transactions must have priceAtTxTime populated on all movements before matching.
 */
export class LotMatcher {
  private readonly logger = getLogger('LotMatcher');

  constructor(
    private readonly transactionRepository?: TransactionQueries | undefined,
    private readonly linkRepository?: TransactionLinkQueries | undefined
  ) {}

  /**
   * Match transactions to create acquisition lots and disposals
   *
   * @param transactions - List of transactions to process (must have prices populated)
   * @param config - Matching configuration
   * @returns Result containing lots and disposals grouped by asset
   */
  async match(
    transactions: UniversalTransactionData[],
    config: LotMatcherConfig
  ): Promise<Result<LotMatchResult, Error>> {
    try {
      // Validate all transactions have prices
      const missingPrices = filterTransactionsWithoutPrices(transactions);
      if (missingPrices.length > 0) {
        return err(
          new Error(
            `Cannot calculate cost basis: ${missingPrices.length} transactions missing price data. ` +
              `Transaction IDs: ${missingPrices.map((t) => t.id).join(', ')}`
          )
        );
      }

      // Load confirmed transaction links (≥95% confidence) if repository is available
      // Include blockchain_internal links so we can skip them during matching
      let confirmedLinks: TransactionLink[] = [];
      if (this.linkRepository) {
        const linksResult = await this.linkRepository.findAll('confirmed');
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }
        confirmedLinks = linksResult.value.filter((link) => link.confidenceScore.gte(0.95));
        this.logger.debug({ linkCount: confirmedLinks.length }, 'Loaded confirmed transaction links for lot matching');
      }

      // Sort transactions by dependency order (topological sort with chronological tie-breaking)
      const sortResult = sortTransactionsByDependency(transactions, confirmedLinks);
      if (sortResult.isErr()) {
        return err(sortResult.error);
      }
      const sortedTransactions = sortResult.value;

      // Build link index for efficient lookup during matching
      const linkIndex = new LinkIndex(confirmedLinks);

      // Per-asset mutable state for the global transaction pass
      const lotStateByAssetId = new Map<string, AssetProcessingState>();
      const sharedLotTransfers: LotTransfer[] = [];
      const transfersByLinkId = new Map<string, LotTransfer[]>();

      // Per-asset error collection: failed assets are excluded from further processing
      const failedAssetIds = new Set<string>();
      const errors: AssetMatchError[] = [];

      // Global transaction loop: process each transaction in dependency order
      for (const tx of sortedTransactions) {
        // Phase 1: Process outflows (disposals and transfer sources)
        const outflows = tx.movements.outflows || [];
        for (const outflow of outflows) {
          if (Currency.create(outflow.assetSymbol).isFiat()) continue;
          if (failedAssetIds.has(outflow.assetId)) continue;

          const assetState = this.getOrInitAssetState(outflow.assetId, outflow.assetSymbol, lotStateByAssetId);
          const linkResult = this.findEffectiveSourceLink(linkIndex, tx.id, outflow);

          if (linkResult.type === 'transfer') {
            const { link, isPartialOutflow } = linkResult;
            const effectiveAmount = isPartialOutflow ? link.sourceAmount : undefined;

            const transferResult = this.handleTransferSource(
              tx,
              outflow,
              link,
              assetState.lots,
              config,
              config.calculationId,
              effectiveAmount
            );
            if (transferResult.isErr()) {
              this.logger.warn(
                { assetId: outflow.assetId, assetSymbol: outflow.assetSymbol, error: transferResult.error.message },
                'Per-asset error during transfer source processing; excluding asset from results'
              );
              failedAssetIds.add(outflow.assetId);
              errors.push({
                assetId: outflow.assetId,
                assetSymbol: outflow.assetSymbol,
                error: transferResult.error.message,
              });
              continue;
            }

            // Record transfers into shared list, per-asset state, and link index
            for (const transfer of transferResult.value.transfers) {
              sharedLotTransfers.push(transfer);
              assetState.lotTransfers.push(transfer);
              const existing = transfersByLinkId.get(transfer.linkId) ?? [];
              existing.push(transfer);
              transfersByLinkId.set(transfer.linkId, existing);
            }

            assetState.disposals.push(...transferResult.value.disposals);
            assetState.lots.splice(0, assetState.lots.length, ...transferResult.value.updatedLots);
            linkIndex.consumeSourceLink(link);
          } else if (linkResult.type === 'none') {
            const result = matchOutflowDisposal(tx, outflow, assetState.lots, config.strategy);
            if (result.isErr()) {
              this.logger.warn(
                { assetId: outflow.assetId, assetSymbol: outflow.assetSymbol, error: result.error.message },
                'Per-asset error during disposal matching; excluding asset from results'
              );
              failedAssetIds.add(outflow.assetId);
              errors.push({ assetId: outflow.assetId, assetSymbol: outflow.assetSymbol, error: result.error.message });
              continue;
            }
            assetState.disposals.push(...result.value.disposals);
            assetState.lots.splice(0, assetState.lots.length, ...result.value.updatedLots);
          }
          // linkResult.type === 'internal_only' → skip outflow
        }

        // Phase 2: Process inflows (acquisitions and transfer targets)
        const inflows = tx.movements.inflows || [];

        // Group inflows by assetId within this transaction
        const inflowsByAsset = new Map<string, AssetMovement[]>();
        for (const inflow of inflows) {
          if (Currency.create(inflow.assetSymbol).isFiat()) continue;
          const existing = inflowsByAsset.get(inflow.assetId) ?? [];
          existing.push(inflow);
          inflowsByAsset.set(inflow.assetId, existing);
        }

        for (const [assetId, assetInflows] of inflowsByAsset) {
          if (failedAssetIds.has(assetId)) continue;

          const assetState = this.getOrInitAssetState(assetId, assetInflows[0]!.assetSymbol, lotStateByAssetId);
          const linkResult = this.findEffectiveTargetLink(linkIndex, tx.id, assetId);

          if (linkResult.type === 'transfer') {
            const { link } = linkResult;
            // Aggregate all inflows of this asset for transfer targets
            // Use netAmount for consistency with link.targetAmount (net received amount)
            const totalAmount = assetInflows.reduce(
              (sum, inflow) => sum.plus(inflow.netAmount ?? inflow.grossAmount),
              parseDecimal('0')
            );

            // Use first inflow as template with aggregated amount
            const aggregatedInflow: AssetMovement = {
              ...assetInflows[0]!,
              grossAmount: totalAmount,
            };

            // Handle transfer target with pre-filtered transfers for this link
            const transfersForLink = transfersByLinkId.get(link.id) ?? [];
            const lotResult = await this.handleTransferTarget(tx, aggregatedInflow, link, transfersForLink, config);
            if (lotResult.isErr()) {
              const assetSymbol = assetInflows[0]!.assetSymbol;
              this.logger.warn(
                { assetId, assetSymbol, error: lotResult.error.message },
                'Per-asset error during transfer target processing; excluding asset from results'
              );
              failedAssetIds.add(assetId);
              errors.push({ assetId, assetSymbol, error: lotResult.error.message });
              continue;
            }
            assetState.lots.push(lotResult.value);
            linkIndex.consumeTargetLink(link);
          } else if (linkResult.type === 'none') {
            // Handle each inflow as regular acquisition
            for (const inflow of assetInflows) {
              const lotResult = buildAcquisitionLotFromInflow(
                tx,
                inflow,
                config.calculationId,
                config.strategy.getName()
              );
              if (lotResult.isErr()) {
                this.logger.warn(
                  { assetId, assetSymbol: inflow.assetSymbol, error: lotResult.error.message },
                  'Per-asset error during acquisition lot creation; excluding asset from results'
                );
                failedAssetIds.add(assetId);
                errors.push({ assetId, assetSymbol: inflow.assetSymbol, error: lotResult.error.message });
                break;
              }
              assetState.lots.push(lotResult.value);
            }
          }
          // linkResult.type === 'internal_only' → skip inflows
        }
      }

      // Build asset results from accumulated state, excluding failed assets
      const assetResults: AssetLotMatchResult[] = [];
      for (const [assetId, state] of lotStateByAssetId) {
        if (failedAssetIds.has(assetId)) continue;
        assetResults.push({
          assetId,
          assetSymbol: state.assetSymbol,
          lots: state.lots,
          disposals: state.disposals,
          lotTransfers: state.lotTransfers,
        });
      }

      if (errors.length > 0) {
        this.logger.warn(
          { failedAssets: errors.map((e) => e.assetSymbol), errorCount: errors.length },
          'Lot matching completed with per-asset errors; partial results returned'
        );
      }

      // Calculate totals
      const totalLotsCreated = assetResults.reduce((sum, r) => sum + r.lots.length, 0);
      const totalDisposalsProcessed = assetResults.reduce((sum, r) => sum + r.disposals.length, 0);
      const totalTransfersProcessed = assetResults.reduce((sum, r) => sum + r.lotTransfers.length, 0);

      return ok({
        assetResults,
        totalLotsCreated,
        totalDisposalsProcessed,
        totalTransfersProcessed,
        errors,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get or initialize per-asset processing state.
   */
  private getOrInitAssetState(
    assetId: string,
    assetSymbol: string,
    lotStateByAssetId: Map<string, AssetProcessingState>
  ): AssetProcessingState {
    let state = lotStateByAssetId.get(assetId);
    if (!state) {
      state = { assetSymbol, lots: [], disposals: [], lotTransfers: [] };
      lotStateByAssetId.set(assetId, state);
    }
    return state;
  }

  /**
   * Find the effective source link for an outflow, skipping blockchain_internal links.
   *
   * A UTXO outflow can have both a blockchain_internal link (change output) and a cross-source
   * link (exchange withdrawal). This method consumes internal links and returns the first
   * non-internal link.
   *
   * When blockchain_internal links were consumed before finding a cross-source link,
   * isPartialOutflow=true signals that the link's sourceAmount (adjusted: gross minus change)
   * should be used instead of the full outflow amount for variance checks and disposal.
   */
  private findEffectiveSourceLink(linkIndex: LinkIndex, txId: number, outflow: AssetMovement): SourceLinkResult {
    // Three-level source lookup:
    // 1. netAmount ?? grossAmount — matches cross-source links (convertToCandidates uses netAmount)
    // 2. grossAmount — matches blockchain_internal links (extractPrimaryAmount uses grossAmount)
    // 3. (txId, asset) only — matches UTXO cross-source links where sourceAmount is an adjusted
    //    amount (gross minus internal change) that differs from both netAmount and grossAmount
    const findLink = (): TransactionLink | undefined => {
      const lookupAmount = outflow.netAmount ?? outflow.grossAmount;
      let link = linkIndex.findBySource(txId, outflow.assetId, lookupAmount);
      if (!link && outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount)) {
        link = linkIndex.findBySource(txId, outflow.assetId, outflow.grossAmount);
      }
      if (!link) {
        link = linkIndex.findAnyBySource(txId, outflow.assetId);
      }
      return link;
    };

    let foundInternal = false;
    let link = findLink();

    while (link && link.linkType === 'blockchain_internal') {
      this.logger.debug(
        { txId, asset: outflow.assetSymbol, amount: outflow.grossAmount.toFixed() },
        'Consuming blockchain_internal outflow link'
      );
      linkIndex.consumeSourceLink(link);
      foundInternal = true;
      link = findLink();
    }

    if (link) {
      return { type: 'transfer', link, isPartialOutflow: foundInternal };
    }
    return foundInternal ? { type: 'internal_only' } : { type: 'none' };
  }

  /**
   * Find the effective target link for an inflow, skipping blockchain_internal links.
   */
  private findEffectiveTargetLink(linkIndex: LinkIndex, txId: number, assetId: string): TargetLinkResult {
    let foundInternal = false;
    let link = linkIndex.findByTarget(txId, assetId);

    while (link && link.linkType === 'blockchain_internal') {
      this.logger.debug({ txId, assetId }, 'Consuming blockchain_internal inflow link');
      linkIndex.consumeTargetLink(link);
      foundInternal = true;
      link = linkIndex.findByTarget(txId, assetId);
    }

    if (link) {
      return { link, type: 'transfer' };
    }
    return foundInternal ? { type: 'internal_only' } : { type: 'none' };
  }

  private handleTransferSource(
    tx: UniversalTransactionData,
    outflow: AssetMovement,
    link: TransactionLink,
    lots: AcquisitionLot[],
    config: LotMatcherConfig,
    calculationId: string,
    effectiveAmount?: Decimal
  ): Result<{ disposals: LotDisposal[]; transfers: LotTransfer[]; updatedLots: AcquisitionLot[] }, Error> {
    if (!config.jurisdiction) {
      return err(new Error('Jurisdiction configuration is required for handling transfer sources'));
    }

    // Call pure function for business logic
    const result = processTransferSource(
      tx,
      outflow,
      link,
      lots,
      config.strategy,
      calculationId,
      config.jurisdiction,
      config.varianceTolerance,
      effectiveAmount
    );

    if (result.isErr()) {
      return err(result.error);
    }

    const { disposals, transfers, updatedLots, warnings } = result.value;

    // Handle logging side effects
    for (const warning of warnings) {
      if (
        warning.type === 'variance' &&
        warning.data.variancePct &&
        warning.data.netTransferAmount &&
        warning.data.linkTargetAmount
      ) {
        const tolerance = config.varianceTolerance?.warn ?? 1.0;
        this.logger.warn(
          {
            txId: tx.id,
            assetSymbol: warning.data.asset,
            variancePct: warning.data.variancePct.toFixed(2),
            netTransferAmount: warning.data.netTransferAmount.toFixed(),
            linkTargetAmount: warning.data.linkTargetAmount.toFixed(),
            source: tx.source,
          },
          `Transfer variance (${warning.data.variancePct.toFixed(2)}%) exceeds warning threshold (${tolerance.toFixed()}%). ` +
            `Possible hidden fees or incomplete fee metadata. Review exchange fee policies.`
        );
      } else if (warning.type === 'missing-price' && warning.data.feeAmount) {
        this.logger.warn(
          {
            txId: tx.id,
            linkId: warning.data.linkId,
            assetSymbol: warning.data.asset,
            feeAmount: warning.data.feeAmount.toFixed(),
            date: tx.datetime,
          },
          'Crypto fee missing price for add-to-basis policy. Fee will not be added to cost basis. ' +
            'Run "prices enrich" to populate missing prices.'
        );
      }
    }

    return ok({ disposals, transfers, updatedLots });
  }

  /**
   * Handle transfer target - create acquisition lot with inherited cost basis
   *
   * When an inflow matches a transfer link, this creates a new acquisition lot
   * that inherits cost basis from the source lot transfers and adds fiat fees.
   */
  private async handleTransferTarget(
    tx: UniversalTransactionData,
    inflow: AssetMovement,
    link: TransactionLink,
    transfersForLink: LotTransfer[],
    config: LotMatcherConfig
  ): Promise<Result<AcquisitionLot, Error>> {
    // Fetch source transaction (repository dependency - imperative shell)
    if (!this.transactionRepository) {
      return err(new Error('TransactionQueries is required for handling transfer targets'));
    }

    const sourceTxResult = await this.transactionRepository.findById(link.sourceTransactionId);
    if (sourceTxResult.isErr()) {
      return err(sourceTxResult.error);
    }

    const sourceTx = sourceTxResult.value;
    if (!sourceTx) {
      return err(new Error(`Source transaction ${link.sourceTransactionId} not found`));
    }

    // Call pure function for business logic
    const result = processTransferTarget(
      tx,
      inflow,
      link,
      sourceTx,
      transfersForLink,
      config.calculationId,
      config.strategy.getName(),
      config.varianceTolerance
    );

    if (result.isErr()) {
      return err(result.error);
    }

    const { lot, warnings } = result.value;

    // Handle logging side effects
    for (const warning of warnings) {
      if (warning.type === 'no-transfers') {
        this.logger.error(
          {
            linkId: warning.data.linkId,
            targetTxId: warning.data.targetTxId,
            sourceTxId: warning.data.sourceTxId,
          },
          'No lot transfers found for link - source transaction may not have been processed'
        );
      } else if (
        warning.type === 'variance' &&
        warning.data.variancePct &&
        warning.data.transferred &&
        warning.data.received
      ) {
        this.logger.warn(
          {
            linkId: warning.data.linkId,
            targetTxId: warning.data.targetTxId,
            variancePct: warning.data.variancePct.toFixed(2),
            transferred: warning.data.transferred.toFixed(),
            received: warning.data.received.toFixed(),
          },
          `Transfer target variance (${warning.data.variancePct.toFixed(2)}%) exceeds warning threshold. ` +
            `Possible fee discrepancy between source and target data.`
        );
      } else if (warning.type === 'missing-price' && warning.data.feeAsset && warning.data.feeAmount) {
        this.logger.warn(
          {
            txId: warning.data.txId,
            linkId: warning.data.linkId,
            feeassetSymbol: warning.data.feeAsset,
            feeAmount: warning.data.feeAmount.toFixed(),
            date: warning.data.date,
          },
          'Fiat fee missing priceAtTxTime. Fee will not be added to cost basis. ' +
            'Run "prices enrich" to normalize fiat currencies to USD.'
        );
      }
    }

    return ok(lot);
  }
}
