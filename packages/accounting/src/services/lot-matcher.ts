import { Currency, parseDecimal, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';
import { LinkIndex } from '../linking/link-index.js';
import type { TransactionLink } from '../linking/types.js';
import type { TransactionLinkRepository } from '../persistence/transaction-link-repository.js';

import {
  buildAcquisitionLotFromInflow,
  buildDependencyGraph,
  filterTransactionsWithoutPrices,
  groupTransactionsByAsset,
  matchOutflowDisposal,
  processTransferSource,
  processTransferTarget,
  sortAssetGroupsByDependency,
  sortWithLogicalOrdering,
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
 * LotMatcher - Matches disposal transactions to acquisition lots using a specified strategy
 *
 * This service:
 * 1. Groups transactions by asset
 * 2. Creates acquisition lots from inflow transactions
 * 3. Matches outflow transactions (disposals) to acquisition lots using the specified strategy
 * 4. Returns lots and disposals for storage
 *
 * Note: Transactions must have priceAtTxTime populated on all movements before matching.
 */
export class LotMatcher {
  private readonly logger = getLogger('LotMatcher');

  constructor(
    private readonly transactionRepository?: TransactionRepository | undefined,
    private readonly linkRepository?: TransactionLinkRepository | undefined
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

      // Sort transactions with logical ordering (respecting transfer dependencies)
      const sortedTransactions =
        confirmedLinks.length > 0
          ? this.sortTransactionsWithLogicalOrdering(transactions, confirmedLinks)
          : [...transactions].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

      // Build link index for efficient lookup during matching
      const linkIndex = new LinkIndex(confirmedLinks);

      // Group transactions by assetId
      const transactionsByAsset = groupTransactionsByAsset(sortedTransactions);

      // Sort asset groups so that cross-asset transfer sources are processed before targets
      const sortedAssetEntries = sortAssetGroupsByDependency([...transactionsByAsset.entries()], confirmedLinks);

      // Shared lot transfers array across all asset groups for cross-assetId transfers
      const sharedLotTransfers: LotTransfer[] = [];

      // Process each asset separately (in dependency order)
      const assetResults: AssetLotMatchResult[] = [];

      for (const [assetId, { assetSymbol, transactions: assetTransactions }] of sortedAssetEntries) {
        const result = await this.matchAsset(
          assetId,
          assetSymbol,
          assetTransactions,
          config,
          linkIndex,
          sharedLotTransfers
        );
        if (result.isErr()) {
          return err(result.error);
        }
        assetResults.push(result.value);
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
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Match transactions for a single asset (grouped by assetId)
   */
  private async matchAsset(
    assetId: string,
    assetSymbol: string,
    transactions: UniversalTransactionData[],
    config: LotMatcherConfig,
    linkIndex: LinkIndex,
    sharedLotTransfers: LotTransfer[]
  ): Promise<Result<AssetLotMatchResult, Error>> {
    try {
      const lots: AcquisitionLot[] = [];
      const disposals: LotDisposal[] = [];
      const transferStartIdx = sharedLotTransfers.length;

      // Skip fiat currencies - we only track cost basis for crypto assets
      const assetCurrency = Currency.create(assetSymbol);
      if (assetCurrency.isFiat()) {
        return ok({
          assetId,
          assetSymbol,
          lots: [],
          disposals: [],
          lotTransfers: [],
        });
      }

      // Process each transaction (already sorted with logical ordering in match())
      for (const tx of transactions) {
        // Check outflows (disposals or transfer sources)
        const outflows = tx.movements.outflows || [];
        for (const outflow of outflows) {
          if (outflow.assetId === assetId) {
            // Find the effective link for this outflow, consuming any blockchain_internal
            // links along the way. A single outflow can have both a blockchain_internal link
            // (UTXO change) and a cross-source link (exchange withdrawal). We need to consume
            // the internal one and process the cross-source one.
            const linkResult = this.findEffectiveSourceLink(linkIndex, tx.id, outflow);

            if (linkResult.type === 'transfer') {
              const { link, isPartialOutflow } = linkResult;
              // When blockchain_internal links were consumed, the outflow is split: only the
              // link's sourceAmount represents the external transfer (gross minus internal change).
              // Fees are already factored into the UTXO adjustment.
              const effectiveAmount = isPartialOutflow ? link.sourceAmount : undefined;

              // Handle transfer source
              const transferResult = this.handleTransferSource(
                tx,
                outflow,
                link,
                lots,
                config,
                config.calculationId,
                effectiveAmount
              );
              if (transferResult.isErr()) {
                return err(transferResult.error);
              }
              sharedLotTransfers.push(...transferResult.value.transfers);
              disposals.push(...transferResult.value.disposals);
              // Update lots array with new state
              lots.splice(0, lots.length, ...transferResult.value.updatedLots);
              linkIndex.consumeSourceLink(link);
            } else if (linkResult.type === 'none') {
              // Handle regular disposal (no links found at all)
              const result = matchOutflowDisposal(tx, outflow, lots, config.strategy);
              if (result.isErr()) {
                return err(result.error);
              }
              disposals.push(...result.value.disposals);
              // Update lots array with new state
              lots.splice(0, lots.length, ...result.value.updatedLots);
            }
            // linkResult.type === 'internal_only' means only blockchain_internal links found → skip outflow
          }
        }

        // Check inflows (acquisitions or transfer targets)
        const inflows = tx.movements.inflows || [];
        const assetInflows = inflows.filter((inflow) => inflow.assetId === assetId);

        if (assetInflows.length > 0) {
          // Find the effective target link, consuming any blockchain_internal links along the way
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

            // Handle transfer target with aggregated amount
            const lotResult = await this.handleTransferTarget(tx, aggregatedInflow, link, sharedLotTransfers, config);
            if (lotResult.isErr()) {
              return err(lotResult.error);
            }
            lots.push(lotResult.value);
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
                return err(lotResult.error);
              }
              lots.push(lotResult.value);
            }
          }
          // linkResult.type === 'internal_only' means only blockchain_internal links found → skip inflow
        }
      }

      return ok({
        assetId,
        assetSymbol,
        lots,
        disposals,
        lotTransfers: sharedLotTransfers.slice(transferStartIdx),
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
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

  private sortTransactionsWithLogicalOrdering(
    transactions: UniversalTransactionData[],
    links: TransactionLink[]
  ): UniversalTransactionData[] {
    const dependencyGraph = buildDependencyGraph(links);
    return sortWithLogicalOrdering(transactions, dependencyGraph);
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
    lotTransfers: LotTransfer[],
    config: LotMatcherConfig
  ): Promise<Result<AcquisitionLot, Error>> {
    // Fetch source transaction (repository dependency - imperative shell)
    if (!this.transactionRepository) {
      return err(new Error('TransactionRepository is required for handling transfer targets'));
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
      lotTransfers,
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
