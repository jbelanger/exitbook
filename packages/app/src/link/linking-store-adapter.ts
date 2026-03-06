import type { LinkingStore, LinkableMovement, NewLinkableMovement } from '@exitbook/accounting';
import type { NewTransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

/**
 * Adapts DataContext repositories to the LinkingStore port.
 */
export class LinkingStoreAdapter implements LinkingStore {
  constructor(private readonly db: DataContext) {}

  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    return this.db.transactions.findAll();
  }

  countLinks(): Promise<Result<number, Error>> {
    return this.db.transactionLinks.count();
  }

  deleteAllLinks(): Promise<Result<number, Error>> {
    return this.db.transactionLinks.deleteAll();
  }

  saveLinkBatch(links: NewTransactionLink[]): Promise<Result<number, Error>> {
    return this.db.transactionLinks.createBatch(links);
  }

  deleteAllLinkableMovements(): Promise<Result<void, Error>> {
    return this.db.linkableMovements.deleteAll();
  }

  saveLinkableMovementBatch(movements: NewLinkableMovement[]): Promise<Result<number, Error>> {
    return this.db.linkableMovements.createBatch(movements);
  }

  findAllLinkableMovements(): Promise<Result<LinkableMovement[], Error>> {
    return this.db.linkableMovements.findAll();
  }
}
