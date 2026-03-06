import type { CostBasisContext, ICostBasisPersistence } from '@exitbook/accounting';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

/**
 * Adapts DataContext repositories to the ICostBasisPersistence port.
 *
 * Bundles the transaction + confirmed links load into a single
 * domain-shaped context-loading method.
 */
export class CostBasisStoreAdapter implements ICostBasisPersistence {
  constructor(private readonly db: DataContext) {}

  async loadCostBasisContext(): Promise<Result<CostBasisContext, Error>> {
    const transactionsResult = await this.db.transactions.findAll();
    if (transactionsResult.isErr()) return err(transactionsResult.error);

    const linksResult = await this.db.transactionLinks.findAll('confirmed');
    if (linksResult.isErr()) return err(linksResult.error);

    return ok({
      transactions: transactionsResult.value,
      confirmedLinks: linksResult.value,
    });
  }
}
