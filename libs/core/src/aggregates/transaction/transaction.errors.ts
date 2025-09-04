import { DomainError } from '../../errors/domain-errors';

/**
 * Error thrown when a ledger transaction fails balance validation
 * (sum of entries for each currency must equal zero)
 */
export class UnbalancedTransactionError extends DomainError {
  constructor(
    unbalancedCurrencies: Array<{
      currencyId: number;
      delta: string;
      ticker: string;
    }>
  ) {
    const currencyDetails = unbalancedCurrencies.map(c => `${c.ticker}: ${c.delta}`).join(', ');

    super(`Transaction is unbalanced. Currency deltas: ${currencyDetails}`, 'TRANSACTION_UNBALANCED', {
      unbalancedCurrencies,
    });
  }
}

/**
 * Error thrown when attempting to create a transaction with a duplicate external ID
 */
export class DuplicateExternalIdError extends DomainError {
  constructor(externalId: string, source: string, userId: string) {
    super(
      `Transaction with external ID '${externalId}' from source '${source}' already exists for user '${userId}'`,
      'DUPLICATE_EXTERNAL_ID',
      { externalId, source, userId }
    );
  }
}

/**
 * Error thrown when attempting to add an entry to a finalized transaction
 */
export class TransactionFinalizedError extends DomainError {
  constructor(transactionId: number) {
    super(`Cannot modify transaction ${transactionId}: transaction is already finalized`, 'TRANSACTION_FINALIZED', {
      transactionId,
    });
  }
}

/**
 * Error thrown when attempting to create a transaction without any entries
 */
export class EmptyTransactionError extends DomainError {
  constructor() {
    super('Transaction must contain at least one entry', 'EMPTY_TRANSACTION');
  }
}

/**
 * Error thrown when transaction validation fails for business rules
 */
export class TransactionValidationError extends DomainError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Transaction validation failed: ${reason}`, 'TRANSACTION_VALIDATION_FAILED', details);
  }
}

/**
 * Error thrown when attempting to operate on a transaction that doesn't exist
 */
export class TransactionNotFoundError extends DomainError {
  constructor(transactionId: number, userId: string) {
    super(`Transaction with ID ${transactionId} not found for user ${userId}`, 'TRANSACTION_NOT_FOUND', {
      transactionId,
      userId,
    });
  }
}
