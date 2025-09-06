import { Result, ResultAsync, err, fromPromise, ok } from 'neverthrow';

import { CurrencyLookup, LedgerTransaction } from '../aggregates/transaction/ledger-transaction.aggregate';
import { DuplicateExternalIdError, UnbalancedTransactionError } from '../aggregates/transaction/transaction.errors';
import { DomainError } from '../errors/domain-errors';
import { IAccountRepository } from '../repositories/account.repository.interface';
import { ITransactionRepository } from '../repositories/transaction.repository.interface';

/**
 * Transaction validation result
 */
export interface ValidationResult {
  errors: DomainError[];
  isValid: boolean;
  warnings: string[];
}

/**
 * Complex transaction validation error
 */
export class ComplexTransactionValidationError extends DomainError {
  constructor(message: string, validationErrors: DomainError[] = []) {
    super(message, 'COMPLEX_TRANSACTION_VALIDATION_ERROR', { validationErrors });
  }
}

/**
 * Account reference validation error
 */
export class AccountReferenceError extends DomainError {
  constructor(accountId: number, userId: string) {
    super(`Account ${accountId} not found or not accessible by user ${userId}`, 'ACCOUNT_REFERENCE_ERROR', {
      accountId,
      userId,
    });
  }
}

/**
 * Transaction Validator Domain Service
 *
 * Implements complex transaction validation logic that spans multiple
 * aggregates and business rules. This service coordinates validation
 * that cannot be done within a single aggregate.
 *
 * Key responsibilities:
 * - Validate account references in transaction entries
 * - Check for duplicate external IDs across user's transactions
 * - Validate cross-currency transaction rules
 * - Perform complex business rule validation
 * - Coordinate with external currency lookup services
 */
export class TransactionValidatorService {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly accountRepository: IAccountRepository,
    private readonly currencyLookup: CurrencyLookup
  ) {}

  /**
   * Perform comprehensive validation of a transaction before persistence
   * Validates all business rules that span multiple aggregates
   *
   * @param userId - User context for data isolation
   * @param transaction - Transaction to validate
   * @returns ResultAsync<ValidationResult, DomainError> - Validation result
   */
  validateTransaction(userId: string, transaction: LedgerTransaction): ResultAsync<ValidationResult, DomainError> {
    const errors: DomainError[] = [];
    const warnings: string[] = [];

    return this.validateExternalIdUniqueness(userId, transaction)
      .andThen(duplicateResult => {
        if (duplicateResult.isErr()) {
          errors.push(duplicateResult.error);
        }

        return this.validateAccountReferences(userId, transaction);
      })
      .andThen(accountResult => {
        if (accountResult.isErr()) {
          errors.push(accountResult.error);
        }

        return this.validateCurrencyRules(transaction);
      })
      .andThen(currencyResult => {
        if (currencyResult.isErr()) {
          errors.push(currencyResult.error);
        }

        return this.validateBusinessRules(userId, transaction);
      })
      .map(businessResult => {
        if (businessResult.isErr()) {
          errors.push(businessResult.error);
        }

        // Add any warnings discovered during validation
        this.addValidationWarnings(transaction, warnings);

        return {
          errors,
          isValid: errors.length === 0,
          warnings,
        };
      });
  }

  /**
   * Quick validation for basic transaction rules (without external dependencies)
   * Used for performance-critical validation scenarios
   *
   * @param transaction - Transaction to validate
   * @returns Result<ValidationResult, DomainError> - Synchronous validation result
   */
  validateTransactionSync(transaction: LedgerTransaction): Result<ValidationResult, DomainError> {
    const errors: DomainError[] = [];
    const warnings: string[] = [];

    // Synchronous balance check
    if (!transaction.isBalanced()) {
      errors.push(new UnbalancedTransactionError([])); // Simplified - no currency lookup
    }

    // Basic entry validation
    if (transaction.entries.length === 0) {
      errors.push(new ComplexTransactionValidationError('Transaction must have at least one entry'));
    }

    this.addValidationWarnings(transaction, warnings);

    return ok({
      errors,
      isValid: errors.length === 0,
      warnings,
    });
  }

  /**
   * Validate that transaction's external ID is unique within user/source scope
   *
   * @param userId - User context for data isolation
   * @param transaction - Transaction to check
   * @returns ResultAsync<Result<void, DomainError>, DomainError> - Success or uniqueness violation
   */
  private validateExternalIdUniqueness(
    userId: string,
    transaction: LedgerTransaction
  ): ResultAsync<Result<void, DomainError>, DomainError> {
    return this.transactionRepository
      .existsByExternalId(userId, transaction.externalId, transaction.source)
      .map(exists => {
        if (exists) {
          return err(new DuplicateExternalIdError(transaction.externalId, transaction.source, userId));
        }
        return ok();
      });
  }

  /**
   * Validate that all account references in entries exist and belong to user
   * Note: This is a simplified version - in full implementation, entries would have accountId
   *
   * @param userId - User context for data isolation
   * @param transaction - Transaction to validate
   * @returns ResultAsync<Result<void, DomainError>, DomainError> - Success or reference error
   */
  private validateAccountReferences(
    userId: string,
    transaction: LedgerTransaction
  ): ResultAsync<Result<void, DomainError>, DomainError> {
    // Get unique currencies from transaction entries
    const currencies = new Set(transaction.entries.map(entry => entry.amount.currency));

    // Validate that accounts exist for each currency
    const validationPromises = Array.from(currencies).map(currency =>
      this.accountRepository.findByCurrency(userId, currency).map(accounts => {
        if (accounts.length === 0) {
          return err(new AccountReferenceError(-1, userId)); // -1 indicates missing currency account
        }
        return ok();
      })
    );

    return fromPromise(
      Promise.all(
        validationPromises.map(promise =>
          promise.match(
            result => result,
            error => err(error)
          )
        )
      ),
      (error: unknown) =>
        error instanceof DomainError
          ? error
          : new ComplexTransactionValidationError('Failed to validate account references')
    ).map(results => {
      const errors = results.filter(result => result.isErr()).map(result => result.error);
      if (errors.length > 0) {
        return err(errors[0]); // Return first error
      }
      return ok();
    });
  }

  /**
   * Validate currency-specific business rules
   *
   * @param transaction - Transaction to validate
   * @returns ResultAsync<Result<void, DomainError>, DomainError> - Success or currency rule violation
   */
  private validateCurrencyRules(transaction: LedgerTransaction): ResultAsync<Result<void, DomainError>, DomainError> {
    return fromPromise(transaction.finalize(this.currencyLookup), (error: unknown) =>
      error instanceof DomainError ? error : new ComplexTransactionValidationError('Failed to validate currency rules')
    );
  }

  /**
   * Validate complex business rules that apply to transactions
   *
   * @param userId - User context for data isolation
   * @param transaction - Transaction to validate
   * @returns ResultAsync<Result<void, DomainError>, DomainError> - Success or business rule violation
   */
  private validateBusinessRules(
    userId: string,
    transaction: LedgerTransaction
  ): ResultAsync<Result<void, DomainError>, DomainError> {
    // Example business rules validation
    const errors: DomainError[] = [];

    // Rule: Transactions must have at least 2 entries for proper double-entry
    if (transaction.entries.length < 2) {
      errors.push(
        new ComplexTransactionValidationError('Transaction must have at least 2 entries for double-entry accounting')
      );
    }

    // Rule: No entry can have zero amount (should be caught in Entry creation, but double-check)
    const hasZeroAmountEntries = transaction.entries.some(entry => entry.amount.value === 0n);
    if (hasZeroAmountEntries) {
      errors.push(new ComplexTransactionValidationError('Transaction entries cannot have zero amounts'));
    }

    // Rule: Transaction description should be meaningful (warning level)
    if (transaction.description.length < 10) {
      // This would be added to warnings in calling method
    }

    if (errors.length > 0) {
      return fromPromise(
        Promise.resolve(err(errors[0])),
        () => new ComplexTransactionValidationError('Business rule validation failed')
      );
    }

    return fromPromise(
      Promise.resolve(ok()),
      () => new ComplexTransactionValidationError('Business rule validation failed')
    );
  }

  /**
   * Add validation warnings for non-critical issues
   *
   * @param transaction - Transaction to check
   * @param warnings - Warning array to populate
   */
  private addValidationWarnings(transaction: LedgerTransaction, warnings: string[]): void {
    // Warning: Short description
    if (transaction.description.length < 10) {
      warnings.push('Transaction description is very short and may not be descriptive enough');
    }

    // Warning: Many entries (might indicate complexity issues)
    if (transaction.entries.length > 10) {
      warnings.push('Transaction has many entries - consider splitting into multiple transactions');
    }

    // Warning: Mixed currencies without clear exchange pattern
    const currencies = new Set(transaction.entries.map(entry => entry.amount.currency));
    if (currencies.size > 2) {
      warnings.push('Transaction involves multiple currencies - verify exchange rates are appropriate');
    }
  }
}
