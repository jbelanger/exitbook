import type { IPricingPersistence, PricingContext } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

/**
 * Adapts DataContext repositories to the IPricingPersistence port.
 *
 * Bundles related reads into context-loading methods and renames
 * write operations to domain-shaped verbs.
 */
export class PricingStoreAdapter implements IPricingPersistence {
  constructor(private readonly db: DataContext) {}

  async loadPricingContext(): Promise<Result<PricingContext, Error>> {
    const transactionsResult = await this.db.transactions.findAll();
    if (transactionsResult.isErr()) return err(transactionsResult.error);

    const linksResult = await this.db.transactionLinks.findAll('confirmed');
    if (linksResult.isErr()) return err(linksResult.error);

    return ok({
      transactions: transactionsResult.value,
      confirmedLinks: linksResult.value,
    });
  }

  loadTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>> {
    return this.db.transactions.findNeedingPrices(assetFilter);
  }

  saveTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>> {
    return this.db.executeInTransaction((txCtx) => txCtx.transactions.updateMovementsWithPrices(tx));
  }
}
