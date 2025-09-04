import { DomainError } from '../../errors/domain-errors';

/**
 * Error thrown when attempting to perform operations on an inactive user
 */
export class InactiveUserError extends DomainError {
  constructor(userId: string) {
    super(`User ${userId} is inactive and cannot perform this operation`, 'INACTIVE_USER', { userId });
  }
}

/**
 * Error thrown when user attempts to exceed maximum allowed accounts
 */
export class MaxAccountsExceededError extends DomainError {
  constructor(userId: string, maxAccounts: number, currentCount: number) {
    super(
      `User ${userId} has reached the maximum number of accounts (${maxAccounts}). Current count: ${currentCount}`,
      'MAX_ACCOUNTS_EXCEEDED',
      { currentCount, maxAccounts, userId }
    );
  }
}

/**
 * Error thrown when user validation fails
 */
export class UserValidationError extends DomainError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super(`User validation failed: ${reason}`, 'USER_VALIDATION_FAILED', details);
  }
}

/**
 * Error thrown when attempting operations on a non-existent user
 */
export class UserNotFoundError extends DomainError {
  constructor(userId: string) {
    super(`User with ID ${userId} not found`, 'USER_NOT_FOUND', { userId });
  }
}
