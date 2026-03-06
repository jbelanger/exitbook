import type { ILinkingPersistence, LinkableMovement, LinksSaveResult, NewLinkableMovement } from '@exitbook/accounting';
import type { NewTransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

/**
 * Adapts DataContext repositories to the ILinkingPersistence port.
 *
 * Encapsulates the clear-save-readback workflows that the orchestrator
 * previously managed directly.
 */
export class LinkingStoreAdapter implements ILinkingPersistence {
  constructor(private readonly db: DataContext) {}

  loadTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    return this.db.transactions.findAll();
  }

  async replaceMovements(movements: NewLinkableMovement[]): Promise<Result<LinkableMovement[], Error>> {
    // Clear existing movements
    const deleteResult = await this.db.linkableMovements.deleteAll();
    if (deleteResult.isErr()) return err(deleteResult.error);

    // Save new movements
    const saveResult = await this.db.linkableMovements.createBatch(movements);
    if (saveResult.isErr()) return err(saveResult.error);

    // Read back with database-assigned IDs
    return this.db.linkableMovements.findAll();
  }

  async replaceLinks(links: NewTransactionLink[]): Promise<Result<LinksSaveResult, Error>> {
    // Count existing links
    const countResult = await this.db.transactionLinks.count();
    if (countResult.isErr()) return err(countResult.error);
    const previousCount = countResult.value;

    // Clear existing links
    if (previousCount > 0) {
      const deleteResult = await this.db.transactionLinks.deleteAll();
      if (deleteResult.isErr()) return err(deleteResult.error);
    }

    // Save new links
    const saveResult = await this.db.transactionLinks.createBatch(links);
    if (saveResult.isErr()) return err(saveResult.error);

    return ok({ previousCount, savedCount: saveResult.value });
  }
}
