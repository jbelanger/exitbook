import { Result } from 'neverthrow';
import { RepositoryError } from './DomainError';

/**
 * Query: Get Movement Classifications by Purpose
 *
 * Purpose: Retrieve movements filtered by their classified purpose for
 * financial reporting and analysis.
 */
export interface GetMovementsByPurposeQuery {
  readonly purpose: 'PRINCIPAL' | 'FEE' | 'GAS';
  readonly dateRange?: {
    readonly from: string; // ISO timestamp
    readonly to: string; // ISO timestamp
  };
  readonly currency?: string; // Optional currency filter
  readonly limit?: number; // Max results (default 100)
  readonly offset?: number; // Pagination offset (default 0)
  readonly requestId: string; // For query tracing/debugging
}

/**
 * Movement summary for reporting
 */
export interface MovementSummary {
  readonly movementId: string;
  readonly transactionId: string;
  readonly timestamp: string; // ISO timestamp from parent transaction
  readonly money: {
    readonly amount: string; // DecimalString
    readonly currency: string;
  };
  readonly direction: 'IN' | 'OUT';
  readonly classification: {
    readonly purpose: 'PRINCIPAL' | 'FEE' | 'GAS';
    readonly ruleId: string;
    readonly reason: string;
    readonly diagnostics: {
      readonly confidence: number; // DIAGNOSTIC ONLY - no business logic branching in MVP
    };
  };
  readonly source: {
    readonly kind: 'exchange' | 'blockchain';
    readonly venue?: string;
    readonly chain?: string;
  };
}

export interface MovementsByPurposeResult {
  readonly movements: MovementSummary[];
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly executedAt: string; // ISO timestamp
}

export interface GetMovementsByPurposeQueryHandler {
  /**
   * Execute movements by purpose query
   *
   * Input Parameters:
   * - query: GetMovementsByPurposeQuery with purpose filter
   *
   * Validation Rules:
   * - Purpose must be one of: PRINCIPAL, FEE, GAS
   * - Date range timestamps must be valid ISO format
   * - Currency filter must be non-empty string if provided
   * - Limit must be between 1 and 1000 (default 100)
   * - Offset must be non-negative (default 0)
   * - RequestId must be non-empty string for tracing
   *
   * Business Rules:
   * - Query should be read-only (no side effects)
   * - Results ordered by timestamp descending (newest first)
   * - Includes classification metadata for audit trail
   * - Empty result set is valid (not an error)
   * - Confidence scores are diagnostic-only in MVP scope
   *
   * Events Produced: None (read-only query)
   */
  execute(query: GetMovementsByPurposeQuery): Promise<Result<MovementsByPurposeResult, RepositoryError>>;
}
