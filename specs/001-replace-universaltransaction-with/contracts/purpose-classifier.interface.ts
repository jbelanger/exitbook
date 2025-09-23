/**
 * Purpose Classifier Service Contract
 *
 * Provides deterministic classification of movement purposes
 * based on transaction context without external dependencies.
 */

import { ProcessedTransaction, ClassifiedTransaction } from '../types';

export interface PurposeClassifier {
  /**
   * Classify a single transaction's movements
   *
   * @param tx - ProcessedTransaction to classify
   * @returns ClassifiedTransaction with all movements assigned purposes
   * @throws ClassificationError if unable to classify with sufficient confidence
   */
  classify(tx: ProcessedTransaction): ClassifiedTransaction;
}

export interface PurposeClassifierBatch {
  /**
   * Classify multiple transactions in batch for efficiency
   *
   * @param txs - Array of ProcessedTransactions to classify
   * @returns Array of ClassifiedTransactions in same order
   * @throws ClassificationError if any transaction cannot be classified
   */
  classifyMany(txs: ProcessedTransaction[]): ClassifiedTransaction[];
}

export interface ClassificationRule {
  /**
   * Unique identifier for this rule (stable across versions)
   */
  readonly id: string;

  /**
   * Human-readable description of what this rule does
   */
  readonly description: string;

  /**
   * Rule version for audit trail
   */
  readonly version: string;

  /**
   * Check if this rule applies to the given transaction context
   *
   * @param tx - Transaction to evaluate
   * @returns true if rule should be applied
   */
  applies(tx: ProcessedTransaction): boolean;

  /**
   * Apply classification logic to transaction movements
   *
   * @param tx - Transaction to classify
   * @returns Classification results for applicable movements
   */
  classify(tx: ProcessedTransaction): ClassificationResult[];
}

export interface ClassificationResult {
  /**
   * Movement ID this classification applies to
   */
  movementId: string;

  /**
   * Assigned purpose
   */
  purpose: MovementPurpose;

  /**
   * Classification confidence (0..1)
   */
  confidence: number;

  /**
   * Human-readable reason for classification
   */
  reason: string;
}

export interface ClassificationMetrics {
  /**
   * Total transactions processed
   */
  transactionsProcessed: number;

  /**
   * Total movements classified
   */
  movementsClassified: number;

  /**
   * Rule usage counts by rule ID
   */
  ruleUsage: Record<string, number>;

  /**
   * Confidence distribution (buckets: 0-0.2, 0.2-0.4, etc.)
   */
  confidenceDistribution: Record<string, number>;

  /**
   * Percentage of movements classified as OTHER
   */
  otherPercentage: number;

  /**
   * Average confidence score
   */
  averageConfidence: number;
}

export class ClassificationError extends Error {
  constructor(
    message: string,
    public transactionId: string,
    public movementId?: string,
    public confidence?: number
  ) {
    super(message);
    this.name = 'ClassificationError';
  }
}

/**
 * Configuration for purpose classifier
 */
export interface ClassifierConfig {
  /**
   * Minimum confidence threshold for classification
   */
  minConfidence: number;

  /**
   * Whether to throw on low confidence or mark as OTHER
   */
  strictMode: boolean;

  /**
   * Maximum percentage of OTHER classifications before warning
   */
  maxOtherPercentage: number;

  /**
   * Enable detailed logging for debugging
   */
  enableDebugLogging: boolean;
}