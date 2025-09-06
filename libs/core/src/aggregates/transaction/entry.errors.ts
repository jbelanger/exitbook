import { DomainError } from '../../errors/domain-errors';

/**
 * Error thrown when attempting to create an entry with zero amount
 */
export class ZeroAmountEntryError extends DomainError {
  constructor() {
    super('Entry amount cannot be zero', 'ZERO_AMOUNT_ENTRY');
  }
}

/**
 * Error thrown when entry account currency doesn't match entry amount currency
 */
export class EntryCurrencyMismatchError extends DomainError {
  constructor(accountCurrency: string, entryCurrency: string) {
    super(
      `Entry currency '${entryCurrency}' does not match account currency '${accountCurrency}'`,
      'ENTRY_CURRENCY_MISMATCH',
      { accountCurrency, entryCurrency }
    );
  }
}

/**
 * Error thrown when attempting to create an entry with invalid precision
 */
export class InvalidEntryPrecisionError extends DomainError {
  constructor(currency: string, maxDecimals: number, providedDecimals: number) {
    super(
      `Entry amount precision exceeds maximum for currency '${currency}'. Max: ${maxDecimals}, Provided: ${providedDecimals}`,
      'INVALID_ENTRY_PRECISION',
      { currency, maxDecimals, providedDecimals }
    );
  }
}

/**
 * Error thrown when entry references a non-existent account
 */
export class EntryAccountNotFoundError extends DomainError {
  constructor(accountId: number, userId: string) {
    super(`Account with ID ${accountId} not found for user ${userId}`, 'ENTRY_ACCOUNT_NOT_FOUND', {
      accountId,
      userId,
    });
  }
}
