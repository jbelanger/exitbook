import type {
  LinkableMovement,
  NewLinkableMovement,
  NewTransactionLink,
  UniversalTransactionData,
} from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port for transaction linking. Will move to @exitbook/accounting.
 */
export interface LinkingStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;

  countLinks(): Promise<Result<number, Error>>;
  deleteAllLinks(): Promise<Result<number, Error>>;
  saveLinkBatch(links: NewTransactionLink[]): Promise<Result<number, Error>>;

  deleteAllLinkableMovements(): Promise<Result<void, Error>>;
  saveLinkableMovementBatch(movements: NewLinkableMovement[]): Promise<Result<number, Error>>;
  findAllLinkableMovements(): Promise<Result<LinkableMovement[], Error>>;
}

export class LinkingStoreAdapter implements LinkingStore {
  constructor(private readonly db: DataContext) {}
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async countLinks(): Promise<Result<number, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async deleteAllLinks(): Promise<Result<number, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async saveLinkBatch(links: NewTransactionLink[]): Promise<Result<number, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async deleteAllLinkableMovements(): Promise<Result<void, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async saveLinkableMovementBatch(movements: NewLinkableMovement[]): Promise<Result<number, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async findAllLinkableMovements(): Promise<Result<LinkableMovement[], Error>> {
    throw new Error('Not implemented');
  }
}
