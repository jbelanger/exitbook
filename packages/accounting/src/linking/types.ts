import type { z } from 'zod';

import type {
  LinkingResultSchema,
  LinkStatusSchema,
  LinkTypeSchema,
  MatchCriteriaSchema,
  MatchingConfigSchema,
  PotentialMatchSchema,
  TransactionCandidateSchema,
  TransactionLinkSchema,
} from './schemas.js';

/**
 * Types inferred from Zod schemas - schemas are the source of truth
 * This ensures runtime validation and compile-time types stay in sync
 */

/**
 * Type of transaction link
 * - exchange_to_blockchain: Exchange withdrawal → Blockchain deposit
 * - blockchain_to_blockchain: Blockchain send → Blockchain receive
 * - exchange_to_exchange: Exchange withdrawal → Exchange deposit
 */
export type LinkType = z.infer<typeof LinkTypeSchema>;

/**
 * Status of a transaction link
 */
export type LinkStatus = z.infer<typeof LinkStatusSchema>;

/**
 * Criteria used for matching transactions
 * - assetMatch: Whether assets match
 * - amountSimilarity: 0-1, closer to 1 is better
 * - timingValid: Source before target, within window
 * - timingHours: Hours between transactions
 * - addressMatch: If we can match blockchain addresses (optional)
 */
export type MatchCriteria = z.infer<typeof MatchCriteriaSchema>;

/**
 * Transaction link - represents a connection between two transactions
 * where one is the source (withdrawal/send) and the other is the target (deposit/receive)
 */
export type TransactionLink = z.infer<typeof TransactionLinkSchema>;

/**
 * A potential match found by the matching algorithm
 */
export type PotentialMatch = z.infer<typeof PotentialMatchSchema>;

/**
 * Simplified transaction data for matching
 */
export type TransactionCandidate = z.infer<typeof TransactionCandidateSchema>;

/**
 * Configuration for the matching algorithm
 * - maxTimingWindowHours: Maximum time window between source and target (default: 48 hours)
 * - minAmountSimilarity: Minimum amount similarity threshold 0-1 (default: 0.95 = 95% match accounting for fees)
 * - minConfidenceScore: Minimum confidence score to suggest a match 0-1 (default: 0.7)
 * - autoConfirmThreshold: Automatically confirm matches above this confidence 0-1 (default: 0.95 = 95% confident)
 */
export type MatchingConfig = z.infer<typeof MatchingConfigSchema>;

/**
 * Result of the linking process
 * - matchedTransactionCount: Total unique transactions involved in links (sources + targets)
 */
export type LinkingResult = z.infer<typeof LinkingResultSchema>;
