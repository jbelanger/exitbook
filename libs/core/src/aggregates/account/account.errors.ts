import { DomainError } from '../../errors/domain-errors';

/**
 * Account validation error
 */
export class AccountValidationError extends DomainError {
  constructor(field: string, message: string) {
    super(`Account validation failed for ${field}: ${message}`, 'ACCOUNT_VALIDATION_ERROR');
  }
}

/**
 * Account not found error
 */
export class AccountNotFoundError extends DomainError {
  constructor(
    public readonly userId: string,
    public readonly accountId: number
  ) {
    super(`Account with ID ${accountId} not found for user ${userId}`, 'ACCOUNT_NOT_FOUND_ERROR');
  }
}

/**
 * Duplicate account error - user already has account for this currency/source
 */
export class DuplicateAccountError extends DomainError {
  constructor(
    public readonly userId: string,
    public readonly currencyTicker: string,
    public readonly source: string
  ) {
    super(`User ${userId} already has an account for ${currencyTicker} from ${source}`, 'DUPLICATE_ACCOUNT_ERROR');
  }
}

/**
 * Invalid account type error
 */
export class InvalidAccountTypeError extends DomainError {
  constructor(public readonly accountType: string) {
    super(`Invalid account type: ${accountType}`, 'INVALID_ACCOUNT_TYPE_ERROR');
  }
}

/**
 * Account operation not allowed error
 */
export class AccountOperationNotAllowedError extends DomainError {
  constructor(
    public readonly accountId: number,
    public readonly operation: string,
    public readonly reason: string
  ) {
    super(
      `Operation '${operation}' not allowed on account ${accountId}: ${reason}`,
      'ACCOUNT_OPERATION_NOT_ALLOWED_ERROR'
    );
  }
}
