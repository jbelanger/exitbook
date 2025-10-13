import type { Decimal } from 'decimal.js';

/**
 * Type of transaction link
 */
export type LinkType =
  | 'exchange_to_blockchain' // Exchange withdrawal → Blockchain deposit
  | 'blockchain_to_blockchain' // Blockchain send → Blockchain receive
  | 'exchange_to_exchange'; // Exchange withdrawal → Exchange deposit

/**
 * Status of a transaction link
 */
export type LinkStatus = 'suggested' | 'confirmed' | 'rejected';

/**
 * Criteria used for matching transactions
 */
export interface MatchCriteria {
  assetMatch: boolean;
  amountSimilarity: Decimal; // 0-1, closer to 1 is better
  timingValid: boolean; // Source before target, within window
  timingHours: number; // Hours between transactions
  addressMatch?: boolean | undefined; // If we can match blockchain addresses
}

/**
 * Transaction link - represents a connection between two transactions
 * where one is the source (withdrawal/send) and the other is the target (deposit/receive)
 */
export interface TransactionLink {
  id: string;
  sourceTransactionId: number; // FK to transactions.id (withdrawal/send)
  targetTransactionId: number; // FK to transactions.id (deposit/receive)
  linkType: LinkType;
  confidenceScore: Decimal; // 0-1, higher is more confident
  matchCriteria: MatchCriteria;
  status: LinkStatus;
  reviewedBy?: string | undefined; // User who confirmed/rejected
  reviewedAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * A potential match found by the matching algorithm
 */
export interface PotentialMatch {
  sourceTransaction: TransactionCandidate;
  targetTransaction: TransactionCandidate;
  confidenceScore: Decimal;
  matchCriteria: MatchCriteria;
  linkType: LinkType;
}

/**
 * Simplified transaction data for matching
 */
export interface TransactionCandidate {
  id: number;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  externalId: string | undefined;
  timestamp: Date;
  asset: string; // Primary asset from movements
  amount: Decimal; // Primary amount from movements
  direction: 'in' | 'out' | 'neutral';
  fromAddress: string | undefined;
  toAddress: string | undefined;
}

/**
 * Configuration for the matching algorithm
 */
export interface MatchingConfig {
  /**
   * Maximum time window between source and target (in hours)
   * Default: 48 hours
   */
  maxTimingWindowHours: number;

  /**
   * Minimum amount similarity threshold (0-1)
   * Default: 0.95 (95% match accounting for fees)
   */
  minAmountSimilarity: Decimal;

  /**
   * Minimum confidence score to suggest a match (0-1)
   * Default: 0.7
   */
  minConfidenceScore: Decimal;

  /**
   * Automatically confirm matches above this confidence (0-1)
   * Default: 0.95 (95% confident)
   */
  autoConfirmThreshold: Decimal;
}

/**
 * Result of the linking process
 */
export interface LinkingResult {
  suggestedLinks: PotentialMatch[];
  confirmedLinks: TransactionLink[];
  totalSourceTransactions: number;
  totalTargetTransactions: number;
  matchedCount: number;
  unmatchedSourceCount: number;
  unmatchedTargetCount: number;
}
