// Handler for prices derive command
// Wraps PriceEnrichmentService to deduce prices from transaction history

import { PriceEnrichmentService, TransactionLinkRepository } from '@exitbook/accounting';
import type { UniversalTransaction } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

const logger = getLogger('PricesDeriveHandler');

/**
 * Result of the prices derive operation
 */
export interface PricesDeriveResult {
  /** Number of movements enriched with derived prices */
  movementsEnriched: number;

  /** Number of movements still needing prices after derivation */
  movementsStillNeedingPrices: number;

  /** Total number of movements across all transactions */
  totalMovements: number;
}

/**
 * Handler for prices derive command.
 * Deduces prices from transaction data (fiat/stable trades).
 *
 * Phase 2 Enhancement:
 * - Now uses transaction links to enable cross-platform price propagation
 * - Prices can flow from exchange → blockchain and across blockchains
 */
export class PricesDeriveHandler {
  private transactionRepo: TransactionRepository;
  private linkRepo: TransactionLinkRepository;
  private priceService: PriceEnrichmentService;

  constructor(private db: KyselyDB) {
    this.transactionRepo = new TransactionRepository(db);
    this.linkRepo = new TransactionLinkRepository(db);
    this.priceService = new PriceEnrichmentService(this.transactionRepo, this.linkRepo);
  }

  /**
   * Execute prices derive command
   */
  async execute(): Promise<Result<PricesDeriveResult, Error>> {
    try {
      logger.info('Starting price derivation from transaction history');

      // Count movements before enrichment
      const beforeResult = await this.transactionRepo.getTransactions();
      if (beforeResult.isErr()) {
        return err(beforeResult.error);
      }

      const movementsBeforeEnrichment = this.countMovementsWithoutPrices(beforeResult.value);

      // Call existing price enrichment service
      const enrichmentResult = await this.priceService.enrichPrices();

      if (enrichmentResult.isErr()) {
        return err(enrichmentResult.error);
      }

      logger.info(`Price derivation completed`);

      // Count movements after enrichment
      const afterResult = await this.transactionRepo.getTransactions();
      if (afterResult.isErr()) {
        return err(afterResult.error);
      }

      const allTransactions = afterResult.value;
      const movementsAfterEnrichment = this.countMovementsWithoutPrices(allTransactions);
      const totalMovements = this.countAllMovements(allTransactions);

      const movementsEnriched = movementsBeforeEnrichment - movementsAfterEnrichment;
      const movementsStillNeedingPrices = movementsAfterEnrichment;

      return ok({
        movementsEnriched,
        movementsStillNeedingPrices,
        totalMovements,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    // No resources to cleanup
  }

  /**
   * Count total number of movements across all transactions
   * Excludes fiat currencies as they don't need prices (they ARE the price)
   */
  private countAllMovements(transactions: UniversalTransaction[]): number {
    let count = 0;

    for (const tx of transactions) {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];

      for (const movement of [...inflows, ...outflows]) {
        // Skip fiat currencies - they don't need prices
        const currency = Currency.create(movement.asset);
        if (currency.isFiat()) {
          continue;
        }
        count++;
      }
    }

    return count;
  }

  /**
   * Count movements without prices across all transactions
   * Excludes fiat currencies as they don't need prices (they ARE the price)
   */
  private countMovementsWithoutPrices(transactions: UniversalTransaction[]): number {
    let count = 0;

    for (const tx of transactions) {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];

      for (const movement of [...inflows, ...outflows]) {
        // Skip fiat currencies - they don't need prices (they ARE the price)
        const currency = Currency.create(movement.asset);
        if (currency.isFiat()) {
          continue;
        }

        if (!movement.priceAtTxTime) {
          count++;
        }
      }
    }

    return count;
  }
}
