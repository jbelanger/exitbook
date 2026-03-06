import type { UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';

import type { LinkableMovement, NewLinkableMovement } from '../linking/pre-linking/types.js';
import type { NewTransactionLink } from '../linking/types.js';

/**
 * Port for transaction linking persistence.
 * Implemented by LinkingStoreAdapter in the app layer.
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
