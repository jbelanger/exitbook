import { Result } from 'neverthrow';
import { ClassifiedTransaction, RepositoryError } from '@crypto/core';

/**
 * Query: Get Classified Transaction by ID
 *
 * Purpose: Retrieve a single ClassifiedTransaction with its purpose-classified
 * movements for display, analysis, or downstream processing.
 */
export interface GetClassifiedTransactionQuery {
  readonly transactionId: string; // External ID from source system
  readonly requestId: string; // For query tracing/debugging
}

/**
 * Query Handler Interface
 */
export interface GetClassifiedTransactionQueryHandler {
  /**
   * Execute classified transaction retrieval
   *
   * Input Parameters:
   * - query: GetClassifiedTransactionQuery with transaction ID
   *
   * Validation Rules:
   * - TransactionId must be non-empty string
   * - TransactionId must match existing classified transaction
   * - RequestId must be non-empty string for tracing
   *
   * Business Rules:
   * - Query should be read-only (no side effects)
   * - Returns classified transaction with all movement details
   * - Includes classification metadata (rule ID, confidence, reasoning)
   * - Not found is a valid result (wrapped in Result type)
   * - Confidence scores are diagnostic-only in MVP scope
   *
   * Events Produced: None (read-only query)
   */
  execute(query: GetClassifiedTransactionQuery): Promise<Result<ClassifiedTransaction, RepositoryError>>;
}
