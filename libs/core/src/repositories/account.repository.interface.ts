import { ResultAsync } from 'neverthrow';

import { Account, AccountType, CreateAccountData } from '../aggregates/account/account.aggregate';
import { DomainError } from '../errors/domain-errors';

/**
 * Account Repository Interface
 *
 * Defines the contract for persisting and retrieving Account aggregates.
 * All operations are user-scoped to enforce multi-tenant security.
 *
 * Following Domain-Driven Design principles:
 * - Repository pattern for aggregate persistence
 * - Dependency inversion - core defines interface, infrastructure implements
 * - All operations return ResultAsync for explicit error handling
 * - User context is always required for data isolation
 * - Enforces business rule: one account per currency/source per user
 */
export interface IAccountRepository {
  /**
   * Count total accounts for user
   * Used for account limits and reporting
   *
   * @param userId - User context for data isolation
   * @returns ResultAsync<number, DomainError> - Total count of user's accounts
   */
  countByUser(userId: string): ResultAsync<number, DomainError>;

  /**
   * Create a new account for a user
   * Must enforce uniqueness constraint: one account per currency/source per user
   *
   * @param userId - User context for data isolation
   * @param accountData - Account creation data
   * @returns ResultAsync<Account, DomainError> - Created account or domain error
   */
  create(userId: string, accountData: CreateAccountData): ResultAsync<Account, DomainError>;

  /**
   * Delete an account by ID within user context
   * Should validate no transactions reference this account
   *
   * @param userId - User context for data isolation
   * @param id - Database ID of the account to delete
   * @returns ResultAsync<boolean, DomainError> - True if deleted, false if not found
   */
  delete(userId: string, id: number): ResultAsync<boolean, DomainError>;

  /**
   * Check if account exists for currency/source combination
   * Used during account creation to prevent duplicates
   *
   * @param userId - User context for data isolation
   * @param currencyTicker - Currency ticker to check
   * @param source - Source system to check
   * @returns ResultAsync<boolean, DomainError> - True if exists, false otherwise
   */
  exists(userId: string, currencyTicker: string, source: string): ResultAsync<boolean, DomainError>;

  /**
   * Find accounts by currency ticker within user context
   * Used when user has multiple sources for same currency
   *
   * @param userId - User context for data isolation
   * @param currencyTicker - Currency ticker filter
   * @returns ResultAsync<Account[], DomainError> - List of matching accounts
   */
  findByCurrency(userId: string, currencyTicker: string): ResultAsync<Account[], DomainError>;

  /**
   * Find account by its database ID within user context
   *
   * @param userId - User context for data isolation
   * @param id - Database ID of the account
   * @returns ResultAsync<Account | null, DomainError> - Account or null if not found
   */
  findById(userId: string, id: number): ResultAsync<Account | null, DomainError>;

  /**
   * Find account by currency ticker and source within user context
   * Primary lookup method for existing accounts during transaction processing
   *
   * @param userId - User context for data isolation
   * @param currencyTicker - Currency ticker (e.g., "BTC", "ETH")
   * @param source - Source system (e.g., "coinbase", "binance")
   * @returns ResultAsync<Account | null, DomainError> - Account or null if not found
   */
  findByIdentifier(userId: string, currencyTicker: string, source: string): ResultAsync<Account | null, DomainError>;

  /**
   * Find accounts by source within user context
   * Used for source-specific operations and reporting
   *
   * @param userId - User context for data isolation
   * @param source - Source system filter
   * @returns ResultAsync<Account[], DomainError> - List of matching accounts
   */
  findBySource(userId: string, source: string): ResultAsync<Account[], DomainError>;

  /**
   * Find accounts by account type within user context
   * Used for accounting reports and balance calculations
   *
   * @param userId - User context for data isolation
   * @param type - Account type filter
   * @returns ResultAsync<Account[], DomainError> - List of matching accounts
   */
  findByType(userId: string, type: AccountType): ResultAsync<Account[], DomainError>;

  /**
   * Find all accounts for a user
   * Used for account listing and user management
   *
   * @param userId - User context for data isolation
   * @returns ResultAsync<Account[], DomainError> - List of user's accounts
   */
  findByUser(userId: string): ResultAsync<Account[], DomainError>;

  /**
   * Find or create account for currency/source combination
   * Atomic operation that prevents race conditions during concurrent imports
   *
   * @param userId - User context for data isolation
   * @param accountData - Account creation data (used if account doesn't exist)
   * @returns ResultAsync<Account, DomainError> - Existing or newly created account
   */
  findOrCreate(userId: string, accountData: CreateAccountData): ResultAsync<Account, DomainError>;

  /**
   * Update an existing account
   * Note: Core account identifiers (currency, source, userId) cannot be changed
   *
   * @param userId - User context for data isolation
   * @param account - Account aggregate to update
   * @returns ResultAsync<Account, DomainError> - Updated account or domain error
   */
  update(userId: string, account: Account): ResultAsync<Account, DomainError>;
}
