import { Currency, type AssetMovement, type UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
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
  /** Asset symbol */
  asset: string;
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
  async match(transactions: UniversalTransaction[], config: LotMatcherConfig): Promise<Result<LotMatchResult, Error>> {
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

      // Group transactions by asset
      const transactionsByAsset = groupTransactionsByAsset(sortedTransactions);

      // Process each asset separately
      const assetResults: AssetLotMatchResult[] = [];

      for (const [asset, assetTransactions] of transactionsByAsset) {
        const result = await this.matchAsset(asset, assetTransactions, config, linkIndex);
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
   * Match transactions for a single asset
   */
  private async matchAsset(
    asset: string,
    transactions: UniversalTransaction[],
    config: LotMatcherConfig,
    linkIndex: LinkIndex
  ): Promise<Result<AssetLotMatchResult, Error>> {
    try {
      const lots: AcquisitionLot[] = [];
      const disposals: LotDisposal[] = [];
      const lotTransfers: LotTransfer[] = [];

      // Skip fiat currencies - we only track cost basis for crypto assets
      const assetCurrency = Currency.create(asset);
      if (assetCurrency.isFiat()) {
        return ok({
          asset,
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
          if (outflow.asset.toString() === asset) {
            // Check if this outflow is part of a confirmed transfer
            // Use netAmount for link matching (link index stores net values from convertToCandidates)
            const link = linkIndex.findBySource(
              tx.id,
              outflow.asset.toString(),
              outflow.netAmount ?? outflow.grossAmount
            );

            if (link) {
              // Handle transfer source
              const transferResult = this.handleTransferSource(tx, outflow, link, lots, config, config.calculationId);
              if (transferResult.isErr()) {
                return err(transferResult.error);
              }
              lotTransfers.push(...transferResult.value.transfers);
              disposals.push(...transferResult.value.disposals);
              // Update lots array with new state
              lots.splice(0, lots.length, ...transferResult.value.updatedLots);
              linkIndex.consumeSourceLink(link);
            } else {
              // Handle regular disposal
              const result = matchOutflowDisposal(tx, outflow, lots, config.strategy);
              if (result.isErr()) {
                return err(result.error);
              }
              disposals.push(...result.value.disposals);
              // Update lots array with new state
              lots.splice(0, lots.length, ...result.value.updatedLots);
            }
          }
        }

        // Check inflows (acquisitions or transfer targets)
        const inflows = tx.movements.inflows || [];
        const assetInflows = inflows.filter((inflow) => inflow.asset.toString() === asset);

        if (assetInflows.length > 0) {
          // Check if this transaction is a transfer target
          const link = linkIndex.findByTarget(tx.id, asset);

          if (link) {
            // Aggregate all inflows of this asset for transfer targets
            // Use netAmount for consistency with link.targetAmount (net received amount)
            const totalAmount = assetInflows.reduce(
              (sum, inflow) => sum.plus(inflow.netAmount ?? inflow.grossAmount),
              new Decimal(0)
            );

            // Use first inflow as template with aggregated amount
            const aggregatedInflow: AssetMovement = {
              ...assetInflows[0]!,
              grossAmount: totalAmount,
            };

            // Handle transfer target with aggregated amount
            const lotResult = await this.handleTransferTarget(tx, aggregatedInflow, link, lotTransfers, config);
            if (lotResult.isErr()) {
              return err(lotResult.error);
            }
            lots.push(lotResult.value);
            linkIndex.consumeTargetLink(link);
          } else {
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
        }
      }

      return ok({
        asset,
        lots,
        disposals,
        lotTransfers,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private sortTransactionsWithLogicalOrdering(
    transactions: UniversalTransaction[],
    links: TransactionLink[]
  ): UniversalTransaction[] {
    const dependencyGraph = buildDependencyGraph(links);
    return sortWithLogicalOrdering(transactions, dependencyGraph);
  }

  private handleTransferSource(
    tx: UniversalTransaction,
    outflow: AssetMovement,
    link: TransactionLink,
    lots: AcquisitionLot[],
    config: LotMatcherConfig,
    calculationId: string
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
      config.varianceTolerance
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
            asset: warning.data.asset,
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
            asset: warning.data.asset,
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
    tx: UniversalTransaction,
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
            feeAsset: warning.data.feeAsset,
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
