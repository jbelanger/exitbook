import { Currency, type AssetMovement, type UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import { createAcquisitionLot } from '../domain/lot.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';
import { LinkIndex } from '../linking/link-index.js';
import type { TransactionLink } from '../linking/types.js';
import type { TransactionLinkRepository } from '../persistence/transaction-link-repository.js';

import {
  buildAcquisitionLotFromInflow,
  buildDependencyGraph,
  buildTransferMetadata,
  calculateInheritedCostBasis,
  calculateNetProceeds,
  calculateTargetCostBasis,
  calculateTransferDisposalAmount,
  collectFiatFees,
  extractCryptoFee,
  filterTransactionsWithoutPrices,
  groupTransactionsByAsset,
  sortWithLogicalOrdering,
  validateTransferVariance,
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
          if (outflow.asset === asset) {
            // Check if this outflow is part of a confirmed transfer
            // Use netAmount for link matching (link index stores net values from convertToCandidates)
            const link = linkIndex.findBySource(tx.id, outflow.asset, outflow.netAmount ?? outflow.grossAmount);

            if (link) {
              // Handle transfer source
              const transferResult = this.handleTransferSource(tx, outflow, link, lots, config, config.calculationId);
              if (transferResult.isErr()) {
                return err(transferResult.error);
              }
              lotTransfers.push(...transferResult.value.transfers);
              disposals.push(...transferResult.value.disposals);
              linkIndex.consumeSourceLink(link);
            } else {
              // Handle regular disposal
              const result = this.matchOutflowToLots(tx, outflow, lots, config);
              if (result.isErr()) {
                return err(result.error);
              }
              disposals.push(...result.value);
            }
          }
        }

        // Check inflows (acquisitions or transfer targets)
        const inflows = tx.movements.inflows || [];
        const assetInflows = inflows.filter((inflow) => inflow.asset === asset);

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

  /**
   * Match an outflow (disposal) to existing acquisition lots
   */
  private matchOutflowToLots(
    transaction: UniversalTransaction,
    outflow: AssetMovement,
    allLots: AcquisitionLot[],
    config: LotMatcherConfig
  ): Result<LotDisposal[], Error> {
    try {
      // Find open lots for this asset
      const openLots = allLots.filter(
        (lot) => lot.asset === outflow.asset && (lot.status === 'open' || lot.status === 'partially_disposed')
      );

      // Calculate net proceeds after fees
      const proceedsResult = calculateNetProceeds(transaction, outflow);
      if (proceedsResult.isErr()) {
        return err(proceedsResult.error);
      }
      const { proceedsPerUnit } = proceedsResult.value;

      // Create disposal request
      const disposal = {
        transactionId: transaction.id,
        asset: outflow.asset,
        quantity: outflow.grossAmount,
        date: new Date(transaction.datetime),
        proceedsPerUnit,
      };

      // Use strategy to match disposal to lots
      try {
        const lotDisposals = config.strategy.matchDisposal(disposal, openLots);

        // Update lot statuses and remaining quantities
        for (const lotDisposal of lotDisposals) {
          const lot = allLots.find((l) => l.id === lotDisposal.lotId);
          if (!lot) {
            return err(new Error(`Lot ${lotDisposal.lotId} not found`));
          }

          // Update remaining quantity
          lot.remainingQuantity = lot.remainingQuantity.minus(lotDisposal.quantityDisposed);

          // Update status
          if (lot.remainingQuantity.isZero()) {
            lot.status = 'fully_disposed';
          } else if (lot.remainingQuantity.lt(lot.quantity)) {
            lot.status = 'partially_disposed';
          }

          lot.updatedAt = new Date();
        }

        return ok(lotDisposals);
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleTransferSource(
    tx: UniversalTransaction,
    outflow: AssetMovement,
    link: TransactionLink,
    lots: AcquisitionLot[],
    config: LotMatcherConfig,
    calculationId: string
  ): Result<{ disposals: LotDisposal[]; transfers: LotTransfer[] }, Error> {
    const cryptoFeeResult = extractCryptoFee(tx, outflow.asset);
    if (cryptoFeeResult.isErr()) {
      return err(cryptoFeeResult.error);
    }

    const cryptoFee = cryptoFeeResult.value;
    const netTransferAmount = outflow.grossAmount.minus(cryptoFee.amount);

    // Validate transfer variance
    const varianceResult = validateTransferVariance(
      netTransferAmount,
      link.targetAmount,
      tx.source,
      tx.id,
      outflow.asset,
      config.varianceTolerance
    );
    if (varianceResult.isErr()) {
      return err(varianceResult.error);
    }

    const { tolerance, variancePct } = varianceResult.value;

    if (variancePct.gt(tolerance.warn)) {
      this.logger.warn(
        {
          txId: tx.id,
          asset: outflow.asset,
          variancePct: variancePct.toFixed(2),
          netTransferAmount: netTransferAmount.toFixed(),
          linkTargetAmount: link.targetAmount.toFixed(),
          source: tx.source,
        },
        `Transfer variance (${variancePct.toFixed(2)}%) exceeds warning threshold (${tolerance.warn.toFixed()}%). ` +
          `Possible hidden fees or incomplete fee metadata. Review exchange fee policies.`
      );
    }

    const openLots = lots.filter((lot) => lot.asset === outflow.asset && lot.remainingQuantity.gt(0));

    if (!config.jurisdiction) {
      return err(new Error('Jurisdiction configuration is required for handling transfer sources'));
    }

    const feePolicy = config.jurisdiction.sameAssetTransferFeePolicy;
    const { amountToMatch } = calculateTransferDisposalAmount(outflow, cryptoFee, feePolicy);

    const disposal = {
      transactionId: tx.id,
      asset: outflow.asset,
      quantity: amountToMatch,
      date: new Date(tx.datetime),
      proceedsPerUnit: new Decimal(0),
    };

    const lotDisposals = config.strategy.matchDisposal(disposal, openLots);

    let cryptoFeeUsdValue: Decimal | undefined = undefined;
    if (cryptoFee.amount.gt(0) && feePolicy === 'add-to-basis') {
      if (!cryptoFee.priceAtTxTime) {
        this.logger.warn(
          {
            txId: tx.id,
            linkId: link.id,
            asset: outflow.asset,
            feeAmount: cryptoFee.amount.toFixed(),
            date: tx.datetime,
          },
          'Crypto fee missing price for add-to-basis policy. Fee will not be added to cost basis. ' +
            'Run "prices enrich" to populate missing prices.'
        );
        cryptoFeeUsdValue = undefined;
      } else {
        cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
      }
    }

    const transfers: LotTransfer[] = [];
    const quantityToTransfer = netTransferAmount;

    for (const lotDisposal of lotDisposals) {
      // Build metadata for crypto fees if using add-to-basis policy
      const metadata = cryptoFeeUsdValue
        ? buildTransferMetadata(
            { ...cryptoFee, priceAtTxTime: cryptoFee.priceAtTxTime },
            feePolicy,
            lotDisposal.quantityDisposed,
            amountToMatch
          )
        : undefined;

      const lot = lots.find((l) => l.id === lotDisposal.lotId);
      if (!lot) {
        return err(new Error(`Lot ${lotDisposal.lotId} not found`));
      }

      transfers.push({
        id: uuidv4(),
        calculationId,
        sourceLotId: lotDisposal.lotId,
        linkId: link.id,
        quantityTransferred: lotDisposal.quantityDisposed.times(quantityToTransfer.dividedBy(amountToMatch)),
        costBasisPerUnit: lot.costBasisPerUnit,
        sourceTransactionId: tx.id,
        targetTransactionId: link.targetTransactionId,
        metadata,
        createdAt: new Date(),
      });

      lot.remainingQuantity = lot.remainingQuantity.minus(lotDisposal.quantityDisposed);

      if (lot.remainingQuantity.isZero()) {
        lot.status = 'fully_disposed';
      } else if (lot.remainingQuantity.lt(lot.quantity)) {
        lot.status = 'partially_disposed';
      }

      lot.updatedAt = new Date();
    }

    const disposals: LotDisposal[] = [];

    if (cryptoFee.amount.gt(0) && feePolicy === 'disposal') {
      const feeDisposal = {
        transactionId: tx.id,
        asset: outflow.asset,
        quantity: cryptoFee.amount,
        date: new Date(tx.datetime),
        proceedsPerUnit: cryptoFee.priceAtTxTime?.price.amount ?? new Decimal(0),
      };

      const feeDisposals = config.strategy.matchDisposal(feeDisposal, openLots);

      for (const lotDisposal of feeDisposals) {
        const lot = lots.find((l) => l.id === lotDisposal.lotId);
        if (!lot) {
          return err(new Error(`Lot ${lotDisposal.lotId} not found`));
        }

        lot.remainingQuantity = lot.remainingQuantity.minus(lotDisposal.quantityDisposed);

        if (lot.remainingQuantity.isZero()) {
          lot.status = 'fully_disposed';
        } else if (lot.remainingQuantity.lt(lot.quantity)) {
          lot.status = 'partially_disposed';
        }

        lot.updatedAt = new Date();
        disposals.push(lotDisposal);
      }
    }

    return ok({ disposals, transfers });
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
    const transfers = lotTransfers.filter((t) => t.linkId === link.id);

    if (transfers.length === 0) {
      this.logger.error(
        {
          linkId: link.id,
          targetTxId: tx.id,
          sourceTxId: link.sourceTransactionId,
        },
        'No lot transfers found for link - source transaction may not have been processed'
      );
      return err(
        new Error(
          `No lot transfers found for link ${link.id} (target tx ${tx.id}). ` +
            `Source transaction ${link.sourceTransactionId} should have been processed first.`
        )
      );
    }

    // Calculate inherited cost basis from source lots
    const { totalCostBasis: inheritedCostBasis, transferredQuantity } = calculateInheritedCostBasis(transfers);

    const receivedQuantity = inflow.grossAmount;

    // Validate transfer variance
    const varianceResult = validateTransferVariance(
      transferredQuantity,
      receivedQuantity,
      tx.source,
      tx.id,
      inflow.asset,
      config.varianceTolerance
    );
    if (varianceResult.isErr()) {
      return err(varianceResult.error);
    }

    const { tolerance, variancePct } = varianceResult.value;

    if (variancePct.gt(tolerance.warn)) {
      this.logger.warn(
        {
          linkId: link.id,
          targetTxId: tx.id,
          variancePct: variancePct.toFixed(2),
          transferred: transferredQuantity.toFixed(),
          received: receivedQuantity.toFixed(),
        },
        `Transfer target variance (${variancePct.toFixed(2)}%) exceeds warning threshold. ` +
          `Possible fee discrepancy between source and target data.`
      );
    }

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

    const fiatFeesResult = collectFiatFees(sourceTx, tx);
    if (fiatFeesResult.isErr()) {
      return err(fiatFeesResult.error);
    }

    const fiatFees = fiatFeesResult.value;

    // Warn about missing prices on fiat fees
    for (const fee of fiatFees) {
      if (!fee.priceAtTxTime) {
        this.logger.warn(
          {
            txId: fee.txId,
            linkId: link.id,
            feeAsset: fee.asset,
            feeAmount: fee.amount.toFixed(),
            date: fee.date,
          },
          'Fiat fee missing priceAtTxTime. Fee will not be added to cost basis. ' +
            'Run "prices enrich" to normalize fiat currencies to USD.'
        );
      }
    }

    // Calculate final cost basis including fiat fees
    const costBasisPerUnit = calculateTargetCostBasis(inheritedCostBasis, fiatFees, receivedQuantity);

    return ok(
      createAcquisitionLot({
        id: uuidv4(),
        calculationId: config.calculationId,
        acquisitionTransactionId: tx.id,
        asset: inflow.asset,
        quantity: receivedQuantity,
        costBasisPerUnit,
        method: config.strategy.getName(),
        transactionDate: new Date(tx.datetime),
      })
    );
  }
}
