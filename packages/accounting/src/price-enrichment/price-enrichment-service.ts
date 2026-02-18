import type { UniversalTransactionData } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { TransactionLinkRepository } from '../persistence/transaction-link-repository.js';

import { buildLinkGraph } from './link-graph-utils.js';
import { enrichFeePricesFromMovements, inferMultiPass, propagatePricesAcrossLinks } from './price-enrichment-utils.js';
import type { TransactionGroup } from './types.js';

const logger = getLogger('PriceEnrichmentService');

function transactionNeedsPrice(transaction: UniversalTransactionData): boolean {
  const inflows = transaction.movements.inflows ?? [];
  const outflows = transaction.movements.outflows ?? [];
  const fees = transaction.fees ?? [];

  return [...inflows, ...outflows, ...fees].some((movement) => {
    return !movement.priceAtTxTime || movement.priceAtTxTime.source === 'fiat-execution-tentative';
  });
}

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
  constructor(
    private readonly transactionRepository: TransactionQueries,
    private readonly linkRepository: TransactionLinkRepository
  ) {}

  /**
   * Main entry point: enrich prices for all transactions needing prices
   */
  async enrichPrices(): Promise<Result<{ transactionsUpdated: number }, Error>> {
    try {
      logger.info('Starting price enrichment process');

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

      // Track which transactions originally needed prices.
      // This avoids a second repository read while preserving update eligibility semantics.
      const txIdsNeedingPrices = new Set(allTransactions.filter(transactionNeedsPrice).map((tx) => tx.id));

      logger.info(
        { totalTransactions: allTransactions.length, needingPrices: txIdsNeedingPrices.size },
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
      const transactionGroups = buildLinkGraph(allTransactions, confirmedLinks);
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
      const { transactions: inferredTxs, modifiedIds: directModifiedIds } = inferMultiPass(sortedTxs);
      logger.debug({ groupId, transactionsEnriched: directModifiedIds.size }, 'Applied multi-pass price inference');

      // Propagate prices from movements to fees
      const txsWithFeePrices = enrichFeePricesFromMovements(inferredTxs);

      // Propagate prices across confirmed links
      // This enables cross-platform price flow (exchange → blockchain → exchange)
      const { enrichedTransactions, modifiedIds: linkModifiedIds } = propagatePricesAcrossLinks(
        group,
        txsWithFeePrices
      );
      if (linkModifiedIds.size > 0) {
        logger.debug(
          {
            groupId,
            transactionsModified: linkModifiedIds.size,
            linkCount: linkChain.length,
          },
          'Propagated prices across confirmed links'
        );
      }

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

        // Check if transaction has any prices to update (movements or fees)
        const inflows = tx.movements.inflows ?? [];
        const outflows = tx.movements.outflows ?? [];
        const fees = tx.fees ?? [];
        const hasPrices = [...inflows, ...outflows, ...fees].some((m) => m.priceAtTxTime);

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
   * Update transaction in database with enriched price data
   *
   * The transaction passed in already has enriched movements with correct priorities
   * applied by the multi-pass algorithm. Just persist it directly.
   */
  private async updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>> {
    try {
      // Persist the complete enriched transaction
      return await this.transactionRepository.updateMovementsWithPrices(tx);
    } catch (error) {
      return wrapError(error, `Failed to update transaction ${tx.id}`);
    }
  }
}
