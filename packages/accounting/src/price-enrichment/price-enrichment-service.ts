import type { AssetMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { Currency, parseDecimal, wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { TransactionLinkRepository } from '../persistence/transaction-link-repository.js';

import { LinkGraphBuilder } from './link-graph-builder.js';
import { calculatePriceFromTrade, extractTradeMovements } from './price-calculation-utils.js';
import type { TransactionGroup } from './types.js';

const logger = getLogger('PriceEnrichmentService');

/**
 * Service for enriching transaction movements with price data
 * derived from the transaction data itself.
 *
 * Implements a direct price enrichment algorithm:
 * 1. Extract execution prices from fiat/stablecoin trades
 * 2. Propagate prices across confirmed transaction links
 * 3. Recalculate crypto-crypto swap ratios using fetched prices
 *
 * Link-aware price propagation:
 * - Uses TransactionLinkRepository to fetch confirmed transaction links
 * - Groups linked transactions together via Union-Find algorithm
 * - Enables price propagation across platforms (exchange ↔ blockchain)
 *
 * Designed for use in a three-step workflow:
 * - derive: Extract execution prices and propagate across links
 * - fetch: Fill remaining gaps with market prices from external providers
 * - derive: Recalculate crypto-crypto swap ratios for accurate cost basis
 */
export class PriceEnrichmentService {
  private readonly linkGraphBuilder: LinkGraphBuilder;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly linkRepository: TransactionLinkRepository
  ) {
    this.linkGraphBuilder = new LinkGraphBuilder();
  }

  /**
   * Main entry point: enrich prices for all transactions needing prices
   */
  async enrichPrices(): Promise<Result<{ transactionsUpdated: number }, Error>> {
    try {
      logger.info('Starting price enrichment process');

      // Find all transactions needing prices
      const needingPricesResult = await this.transactionRepository.findTransactionsNeedingPrices();

      if (needingPricesResult.isErr()) {
        return err(needingPricesResult.error);
      }

      const transactions = needingPricesResult.value;

      // Track which transactions originally needed prices
      const txIdsNeedingPrices = new Set(transactions.map((tx) => tx.id));

      // Get full transaction data - we must process ALL transactions even if none need prices
      // because Pass N+2 recalculates ratios for swaps that already have fetched prices
      const allTransactionsResult = await this.transactionRepository.getTransactions();
      if (allTransactionsResult.isErr()) {
        return err(allTransactionsResult.error);
      }

      const allTransactions = allTransactionsResult.value;

      if (allTransactions.length === 0) {
        logger.info('No transactions in database');
        return ok({ transactionsUpdated: 0 });
      }

      logger.info(
        { totalTransactions: allTransactions.length, needingPrices: transactions.length },
        'Starting price enrichment'
      );

      // Fetch confirmed transaction links
      const linksResult = await this.linkRepository.findAll('confirmed');
      if (linksResult.isErr()) {
        return err(linksResult.error);
      }

      const confirmedLinks = linksResult.value;
      logger.info({ linkCount: confirmedLinks.length }, 'Fetched confirmed transaction links');

      // Build link graph: groups transitively linked transactions together
      // This enables price propagation across platforms (exchange → blockchain → exchange)
      const transactionGroups = this.linkGraphBuilder.buildLinkGraph(allTransactions, confirmedLinks);
      logger.info({ groupCount: transactionGroups.length }, 'Built transaction groups from links');

      let updatedCount = 0;

      // Process each transaction group independently
      for (const group of transactionGroups) {
        const groupResult = await this.enrichTransactionGroup(group, txIdsNeedingPrices);
        if (groupResult.isErr()) {
          logger.error(
            { groupId: group.groupId, sources: Array.from(group.sources), error: groupResult.error },
            'Failed to enrich transaction group'
          );
          continue;
        }

        updatedCount += groupResult.value;
      }

      logger.info({ transactionsUpdated: updatedCount }, 'Price enrichment completed');
      return ok({ transactionsUpdated: updatedCount });
    } catch (error) {
      return wrapError(error, 'Failed to enrich prices');
    }
  }

  /**
   * Enrich prices for a transaction group using multi-pass inference
   *
   * Transaction groups can contain:
   * - Single exchange transactions (no links)
   * - Single blockchain transactions (no links)
   * - Mixed cross-platform transactions (linked via Union-Find)
   *
   * The multi-pass inference algorithm works the same regardless of group composition,
   * but linked groups enable price propagation across platforms.
   */
  private async enrichTransactionGroup(
    group: TransactionGroup,
    txIdsNeedingPrices: Set<number>
  ): Promise<Result<number, Error>> {
    try {
      const { groupId, transactions, sources, linkChain } = group;

      // Log group details for debugging
      logger.debug(
        {
          groupId,
          transactionCount: transactions.length,
          sources: Array.from(sources),
          linkCount: linkChain.length,
        },
        'Processing transaction group'
      );

      // Sort by timestamp for chronological processing
      const sortedTxs = [...transactions].sort((a, b) => {
        const timeA = new Date(a.datetime).getTime();
        const timeB = new Date(b.datetime).getTime();
        return timeA - timeB;
      });

      // Apply direct price enrichment passes
      const { transactions: inferredTxs, modifiedIds: directModifiedIds } = this.inferMultiPass(sortedTxs);

      // Propagate prices from movements to fees (same asset + timestamp)
      const txsWithFeePrices = this.enrichFeePricesFromMovements(inferredTxs);

      // Propagate prices across confirmed links
      // This enables cross-platform price flow (exchange → blockchain → exchange)
      const { enrichedTransactions, modifiedIds: linkModifiedIds } = this.propagatePricesAcrossLinks(
        group,
        txsWithFeePrices
      );

      const enrichedTxs = enrichedTransactions;

      // Combine all modified transaction IDs
      const allModifiedIds = new Set([...directModifiedIds, ...linkModifiedIds]);

      // Update database with enriched prices
      // Include both: (1) transactions that originally needed prices AND
      // (2) transactions modified by link propagation or ratio recalculation
      let updatedCount = 0;
      let skippedCount = 0;
      for (const tx of enrichedTxs) {
        // Skip if this transaction wasn't originally needing prices AND wasn't modified
        if (!txIdsNeedingPrices.has(tx.id) && !allModifiedIds.has(tx.id)) {
          continue;
        }

        // Check if transaction has any prices to update
        const inflows = tx.movements.inflows ?? [];
        const outflows = tx.movements.outflows ?? [];
        const hasPrices = [...inflows, ...outflows].some((m) => m.priceAtTxTime);

        if (!hasPrices) {
          skippedCount++;
          continue;
        }

        const updateResult = await this.updateTransactionPrices(tx);
        if (updateResult.isOk()) {
          updatedCount++;
        }
      }

      if (skippedCount > 0) {
        logger.debug({ groupId, skippedCount }, 'Transactions skipped (no prices could be derived)');
      }

      return ok(updatedCount);
    } catch (error) {
      return wrapError(error, `Failed to enrich prices for transaction group: ${group.groupId}`);
    }
  }

  /**
   * Propagate prices across confirmed transaction links
   *
   * This enables cross-platform price flow:
   * - Exchange withdrawal → Blockchain deposit
   * - Blockchain transfer → Blockchain receive
   * - Exchange withdrawal → Exchange deposit
   *
   * Logic:
   * 1. For each confirmed link, find source and target transactions
   * 2. Match movements by asset (source outflow → target inflow)
   * 3. Copy price from source movement to target movement
   * 4. Set source to 'link-propagated'
   *
   * @param group - Transaction group with linkChain
   * @param transactions - All transactions in the group
   * @returns Object with enriched transactions and IDs of modified transactions
   */
  private propagatePricesAcrossLinks(
    group: TransactionGroup,
    transactions: UniversalTransaction[]
  ): {
    enrichedTransactions: UniversalTransaction[];
    modifiedIds: Set<number>;
  } {
    const { linkChain } = group;

    // Build transaction lookup map for fast access
    const txMap = new Map(transactions.map((tx) => [tx.id, tx]));

    // Track enriched movements for each transaction
    const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();

    for (const link of linkChain) {
      const sourceTx = txMap.get(link.sourceTransactionId);
      const targetTx = txMap.get(link.targetTransactionId);

      if (!sourceTx || !targetTx) {
        logger.warn(
          {
            linkId: link.id,
            sourceId: link.sourceTransactionId,
            targetId: link.targetTransactionId,
          },
          'Link references transactions not in group, skipping'
        );
        continue;
      }

      // Match movements: source outflows → target inflows
      const sourceOutflows = sourceTx.movements.outflows ?? [];
      const targetInflows = targetTx.movements.inflows ?? [];

      // Track which target movements got prices
      const targetMovementPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

      for (const sourceMovement of sourceOutflows) {
        // Skip if source movement doesn't have a price
        if (!sourceMovement.priceAtTxTime) {
          continue;
        }

        // Find matching target movement by asset
        for (const targetMovement of targetInflows) {
          if (targetMovement.asset === sourceMovement.asset) {
            // Check if amounts are reasonably close (allow up to 10% difference for fees)
            const sourceAmount = sourceMovement.amount.toNumber();
            const targetAmount = targetMovement.amount.toNumber();
            const amountDiff = Math.abs(sourceAmount - targetAmount);
            const amountTolerance = sourceAmount * 0.1; // 10% tolerance

            if (amountDiff <= amountTolerance) {
              // Propagate price with 'link-propagated' source
              const propagatedPrice: PriceAtTxTime = {
                ...sourceMovement.priceAtTxTime,
                source: 'link-propagated',
              };

              targetMovementPrices.push({
                asset: targetMovement.asset,
                priceAtTxTime: propagatedPrice,
              });

              logger.debug(
                {
                  sourceTransactionId: sourceTx.id,
                  targetTransactionId: targetTx.id,
                  asset: targetMovement.asset,
                  price: sourceMovement.priceAtTxTime.price,
                  linkType: link.linkType,
                },
                'Propagated price across link'
              );

              // Only match each target movement once
              break;
            }
          }
        }
      }

      // Apply propagated prices to target transaction movements
      // Use overwriteDerivedHistory=true because link propagation is more direct/accurate
      if (targetMovementPrices.length > 0) {
        const enrichedInflows = this.enrichMovements(targetInflows, targetMovementPrices, true);
        const targetOutflows = targetTx.movements.outflows ?? [];

        enrichedMovements.set(targetTx.id, {
          inflows: enrichedInflows,
          outflows: targetOutflows,
        });
      }
    }

    // Return enriched transactions (with link-propagated prices applied)
    const enrichedTransactions = transactions.map((tx) => {
      const enriched = enrichedMovements.get(tx.id);
      if (enriched) {
        return {
          ...tx,
          movements: {
            inflows: enriched.inflows,
            outflows: enriched.outflows,
          },
        };
      }
      return tx;
    });

    // Return modified transaction IDs (those that got link-propagated prices)
    const modifiedIds = new Set(enrichedMovements.keys());

    return {
      enrichedTransactions,
      modifiedIds,
    };
  }

  /**
   * Apply direct price enrichment: extract execution prices and recalculate ratios
   */
  private inferMultiPass(transactions: UniversalTransaction[]): {
    modifiedIds: Set<number>;
    transactions: UniversalTransaction[];
  } {
    // Track which transactions have been enriched with new movements
    const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();
    // Track modifications from Pass N+2 only (not Pass 0, which just applies to movements that need prices)
    const modifiedByRatioRecalc = new Set<number>();

    // Pass 0: Apply exchange-execution prices from fiat/stable trades to their source movements
    // This ensures these movements retain their 'exchange-execution' source (authoritative)
    for (const tx of transactions) {
      const timestamp = new Date(tx.datetime).getTime();
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];

      const trade = extractTradeMovements(inflows, outflows, timestamp);
      if (!trade) {
        continue;
      }

      const prices = calculatePriceFromTrade(trade);

      if (prices.length > 0) {
        const updatedInflows = this.enrichMovements(inflows, prices);
        const updatedOutflows = this.enrichMovements(outflows, prices);

        enrichedMovements.set(tx.id, {
          inflows: updatedInflows,
          outflows: updatedOutflows,
        });
      }
    }

    logger.debug({ transactionsEnriched: enrichedMovements.size }, 'Pass 0: Applied exchange-execution prices');

    // Pass 1: Derive inflow price from outflow when only outflow has price
    // This handles cases where price providers don't have data for exotic assets,
    // but we can still calculate their price from the swap ratio.
    let pricesDerivedFromOutflow = 0;
    for (const tx of transactions) {
      const enriched = enrichedMovements.get(tx.id);
      const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
      const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
      const timestamp = new Date(tx.datetime).getTime();

      const trade = extractTradeMovements(inflows, outflows, timestamp);
      if (!trade) {
        continue;
      }

      // Only process if outflow has price but inflow doesn't
      if (trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
        continue;
      }

      // Calculate inflow price from outflow using swap ratio
      const ratio = trade.outflow.amount.dividedBy(trade.inflow.amount);
      const derivedPrice = trade.outflow.priceAtTxTime.price.amount.times(ratio);

      const ratioPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [
        {
          asset: trade.inflow.asset,
          priceAtTxTime: {
            price: {
              amount: derivedPrice,
              currency: trade.outflow.priceAtTxTime.price.currency,
            },
            source: 'derived-ratio',
            fetchedAt: new Date(timestamp),
            granularity: trade.outflow.priceAtTxTime.granularity,
          },
        },
      ];

      const updatedInflows = this.enrichMovements(inflows, ratioPrices);
      const updatedOutflows = outflows;

      enrichedMovements.set(tx.id, {
        inflows: updatedInflows,
        outflows: updatedOutflows,
      });

      modifiedByRatioRecalc.add(tx.id);
      pricesDerivedFromOutflow++;
    }

    logger.debug({ pricesDerivedFromOutflow }, 'Pass 1: Derived inflow prices from outflow using ratios');

    // Pass N+2: Recalculate crypto-crypto swap ratios
    // When both sides have prices but neither is fiat, recalculate the inflow (acquisition)
    // side from the outflow (disposal) side using the swap ratio.
    // This ensures we use execution price, not market price, for cost basis.
    let swapsRecalculated = 0;
    for (const tx of transactions) {
      const enriched = enrichedMovements.get(tx.id);
      const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
      const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
      const timestamp = new Date(tx.datetime).getTime();

      const trade = extractTradeMovements(inflows, outflows, timestamp);
      if (!trade) {
        continue;
      }

      // Both sides must have prices
      if (!trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
        continue;
      }

      // Check if this is a crypto-crypto swap (neither side is fiat/stable)
      const inflowCurrency = Currency.create(trade.inflow.asset);
      const outflowCurrency = Currency.create(trade.outflow.asset);

      if (inflowCurrency.isFiatOrStablecoin() || outflowCurrency.isFiatOrStablecoin()) {
        continue; // Keep fiat-based prices (they're already execution prices)
      }

      // Both are crypto: recalculate inflow from outflow using swap ratio
      // We trust the outflow price (disposal side) as it should be FMV from fetch
      // Then calculate inflow (acquisition) from the ratio
      const ratio = parseDecimal(trade.outflow.amount.toFixed()).dividedBy(parseDecimal(trade.inflow.amount.toFixed()));
      const derivedPrice = parseDecimal(trade.outflow.priceAtTxTime.price.amount.toFixed()).times(ratio);

      const ratioPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [
        {
          asset: trade.inflow.asset,
          priceAtTxTime: {
            price: {
              amount: derivedPrice,
              currency: trade.outflow.priceAtTxTime.price.currency,
            },
            source: 'derived-ratio',
            fetchedAt: new Date(timestamp),
            granularity: trade.outflow.priceAtTxTime.granularity,
          },
        },
      ];

      // Overwrite the fetched market price with ratio-based execution price
      const updatedInflows = this.enrichMovements(inflows, ratioPrices, true);
      const updatedOutflows = outflows; // Keep outflow prices (disposal FMV)

      enrichedMovements.set(tx.id, {
        inflows: updatedInflows,
        outflows: updatedOutflows,
      });

      // Track that this transaction was modified by ratio recalculation
      modifiedByRatioRecalc.add(tx.id);

      swapsRecalculated++;
    }

    logger.debug({ swapsRecalculated }, 'Pass N+2: Recalculated crypto-crypto swap ratios');

    // Return transactions with enriched movements and IDs of modified transactions
    const enrichedTransactions = transactions.map((tx) => {
      const enriched = enrichedMovements.get(tx.id);
      if (enriched) {
        return {
          ...tx,
          movements: {
            inflows: enriched.inflows,
            outflows: enriched.outflows,
          },
        };
      }
      return tx;
    });

    // Return modified transaction IDs (only from Pass N+2, not Pass 0)
    return {
      transactions: enrichedTransactions,
      modifiedIds: modifiedByRatioRecalc,
    };
  }

  /**
   * Enrich fee movements with prices from regular movements
   *
   * Since fees occur at the same timestamp as the transaction, we can copy prices
   * from inflows/outflows that share the same asset.
   */
  private enrichFeePricesFromMovements(transactions: UniversalTransaction[]): UniversalTransaction[] {
    return transactions.map((tx) => {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];
      const allMovements = [...inflows, ...outflows];

      // Build price lookup map by asset
      const pricesByAsset = new Map<string, PriceAtTxTime>();
      for (const movement of allMovements) {
        if (movement.priceAtTxTime && !pricesByAsset.has(movement.asset)) {
          pricesByAsset.set(movement.asset, movement.priceAtTxTime);
        }
      }

      // Enrich platform fee if needed
      let platformFee = tx.fees.platform;
      if (platformFee && !platformFee.priceAtTxTime) {
        const price = pricesByAsset.get(platformFee.asset);
        if (price) {
          platformFee = { ...platformFee, priceAtTxTime: price };
        }
      }

      // Enrich network fee if needed
      let networkFee = tx.fees.network;
      if (networkFee && !networkFee.priceAtTxTime) {
        const price = pricesByAsset.get(networkFee.asset);
        if (price) {
          networkFee = { ...networkFee, priceAtTxTime: price };
        }
      }

      // Return transaction with enriched fees if any changed
      if (platformFee !== tx.fees.platform || networkFee !== tx.fees.network) {
        return {
          ...tx,
          fees: {
            platform: platformFee,
            network: networkFee,
          },
        };
      }

      return tx;
    });
  }

  /**
   * Update transaction in database with enriched price data
   */
  private async updateTransactionPrices(tx: UniversalTransaction): Promise<Result<void, Error>> {
    try {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];
      const fees = [tx.fees.platform, tx.fees.network].filter(
        (fee): fee is AssetMovement => fee !== undefined && fee !== null
      );

      // Collect all price data for update (including fees)
      const priceData: {
        asset: string;
        fetchedAt: Date;
        granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
        price: { amount: Decimal; currency: Currency };
        source: string;
      }[] = [];

      for (const movement of [...inflows, ...outflows, ...fees]) {
        if (movement.priceAtTxTime) {
          priceData.push({
            asset: movement.asset,
            price: movement.priceAtTxTime.price as { amount: Decimal; currency: Currency },
            source: movement.priceAtTxTime.source,
            fetchedAt: movement.priceAtTxTime.fetchedAt,
            granularity: movement.priceAtTxTime.granularity,
          });
        }
      }

      if (priceData.length === 0) {
        return ok();
      }

      return await this.transactionRepository.updateMovementsWithPrices(tx.id, priceData);
    } catch (error) {
      return wrapError(error, `Failed to update transaction ${tx.id}`);
    }
  }

  /**
   * Enrich movements with price data
   *
   * @param movements - Movements to enrich
   * @param prices - Prices to apply
   * @param overwriteExisting - If true, overwrite existing prices (except exchange-execution)
   *        Used for link propagation and ratio-based pricing
   */
  private enrichMovements(
    movements: AssetMovement[],
    prices: { asset: string; priceAtTxTime: PriceAtTxTime }[],
    overwriteExisting = false
  ): AssetMovement[] {
    const priceMap = new Map(prices.map((p) => [p.asset, p.priceAtTxTime]));

    return movements.map((movement) => {
      const price = priceMap.get(movement.asset);

      if (!price) {
        return movement;
      }

      // Always enrich if no existing price
      if (!movement.priceAtTxTime) {
        return { ...movement, priceAtTxTime: price };
      }

      // Optionally overwrite existing prices (except exchange-execution which is authoritative)
      if (overwriteExisting && movement.priceAtTxTime.source !== 'exchange-execution') {
        return { ...movement, priceAtTxTime: price };
      }

      return movement;
    });
  }
}
