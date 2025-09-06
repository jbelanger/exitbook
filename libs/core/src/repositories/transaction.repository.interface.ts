import { ResultAsync } from 'neverthrow';

import { LedgerTransaction } from '../aggregates/transaction/ledger-transaction.aggregate';
import { DomainError } from '../errors/domain-errors';

/**
 * Transaction Repository Interface
 *
 * Defines the contract for persisting and retrieving LedgerTransaction aggregates.
 * All operations are user-scoped to enforce multi-tenant security.
 *
 * Following Domain-Driven Design principles:
 * - Repository pattern for aggregate persistence
 * - Dependency inversion - core defines interface, infrastructure implements
 * - All operations return ResultAsync for explicit error handling
 * - User context is always required for data isolation
 */
export interface ITransactionRepository {
  /**
   * Count total transactions for user
   * Used for pagination and reporting
   *
   * @param userId - User context for data isolation
   * @returns ResultAsync<number, DomainError> - Total count of user's transactions
   */
  countByUser(userId: string): ResultAsync<number, DomainError>;

  /**
   * Delete a transaction by ID within user context
   * Should only be used for draft transactions or administrative purposes
   *
   * @param userId - User context for data isolation
   * @param id - Database ID of the transaction to delete
   * @returns ResultAsync<boolean, DomainError> - True if deleted, false if not found
   */
  delete(userId: string, id: number): ResultAsync<boolean, DomainError>;

  /**
   * Check if transaction with external ID exists for user/source
   * Used for duplicate detection during import without full retrieval
   *
   * @param userId - User context for data isolation
   * @param externalId - External system identifier
   * @param source - Source system
   * @returns ResultAsync<boolean, DomainError> - True if exists, false otherwise
   */
  existsByExternalId(userId: string, externalId: string, source: string): ResultAsync<boolean, DomainError>;

  /**
   * Find transactions within a date range for user
   *
   * @param userId - User context for data isolation
   * @param startDate - Start of date range (inclusive)
   * @param endDate - End of date range (inclusive)
   * @param limit - Maximum number of results to return
   * @param offset - Number of results to skip for pagination
   * @returns ResultAsync<LedgerTransaction[], DomainError> - List of transactions
   */
  findByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    limit?: number,
    offset?: number
  ): ResultAsync<LedgerTransaction[], DomainError>;

  /**
   * Find transaction by external ID and source within user context
   * Used to prevent duplicate imports from the same source
   *
   * @param userId - User context for data isolation
   * @param externalId - External system identifier for the transaction
   * @param source - Source system that provided the transaction
   * @returns ResultAsync<LedgerTransaction | null, DomainError> - Transaction or null if not found
   */
  findByExternalId(
    userId: string,
    externalId: string,
    source: string
  ): ResultAsync<LedgerTransaction | null, DomainError>;

  /**
   * Find transaction by its database ID within user context
   *
   * @param userId - User context for data isolation
   * @param id - Database ID of the transaction
   * @returns ResultAsync<LedgerTransaction | null, DomainError> - Transaction or null if not found
   */
  findById(userId: string, id: number): ResultAsync<LedgerTransaction | null, DomainError>;

  /**
   * Find transactions by source within user context
   * Used for bulk operations and source-specific queries
   *
   * @param userId - User context for data isolation
   * @param source - Source system filter
   * @param limit - Maximum number of results to return
   * @param offset - Number of results to skip for pagination
   * @returns ResultAsync<LedgerTransaction[], DomainError> - List of transactions
   */
  findBySource(
    userId: string,
    source: string,
    limit?: number,
    offset?: number
  ): ResultAsync<LedgerTransaction[], DomainError>;

  /**
   * Save a transaction to the repository
   *
   * @param userId - User context for data isolation
   * @param transaction - Transaction aggregate to persist
   * @returns ResultAsync<void, DomainError> - Success or domain error
   */
  save(userId: string, transaction: LedgerTransaction): ResultAsync<void, DomainError>;
}
