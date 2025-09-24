/**
 * Purpose Classifier Service Contract
 *
 * Provides deterministic classification of movement purposes
 * based on transaction context without external dependencies.
 */

import type { ProcessedTransaction, ClassifiedTransaction, MovementPurpose } from '@crypto/core';
import type { Result } from 'neverthrow';

export interface PurposeClassifier {
  /**
   * Classify a single transaction's movements
   *
   * @param tx - ProcessedTransaction to classify
   * @returns Result containing ClassifiedTransaction or ClassificationError
   */
  classify(tx: ProcessedTransaction): Result<ClassifiedTransaction, ClassificationError>;
}

export interface PurposeClassifierBatch {
  /**
   * Classify multiple transactions in batch for efficiency
   *
   * @param txs - Array of ProcessedTransactions to classify
   * @returns Result containing array of ClassifiedTransactions or batch error
   */
  classifyMany(txs: ProcessedTransaction[]): Result<ClassifiedTransaction[], ClassificationBatchError>;
}

export interface ClassificationRule {
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
   * @returns Result containing classification results for applicable movements
   */
  classify(tx: ProcessedTransaction): Result<ClassificationResult[], string>;

  /**
   * Human-readable description of what this rule does
   */
  readonly description: string;

  /**
   * Unique identifier for this rule (stable across versions)
   */
  readonly id: string;

  /**
   * Rule version for audit trail
   */
  readonly version: string;
}

export interface ClassificationResult {
  /**
   * Classification confidence (0..1)
   */
  confidence: number;

  /**
   * Movement ID this classification applies to
   */
  movementId: string;

  /**
   * Assigned purpose
   */
  purpose: MovementPurpose;

  /**
   * Human-readable reason for classification
   */
  reason: string;
}

export interface ClassificationMetrics {
  /**
   * Average confidence score
   */
  averageConfidence: number;

  /**
   * Confidence distribution (buckets: 0-0.2, 0.2-0.4, etc.)
   */
  confidenceDistribution: Record<string, number>;

  /**
   * Total movements classified
   */
  movementsClassified: number;

  /**
   * Percentage of movements classified as OTHER
   */
  otherPercentage: number;

  /**
   * Rule usage counts by rule ID
   */
  ruleUsage: Record<string, number>;

  /**
   * Total transactions processed
   */
  transactionsProcessed: number;
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

export class ClassificationBatchError extends Error {
  constructor(
    message: string,
    public failedTransactions: { error: ClassificationError; index: number; transactionId: string }[]
  ) {
    super(message);
    this.name = 'ClassificationBatchError';
  }
}

/**
 * Configuration for purpose classifier
 */
export interface ClassifierConfig {
  /**
   * Enable detailed logging for debugging
   */
  enableDebugLogging: boolean;

  /**
   * Maximum percentage of OTHER classifications before warning
   */
  maxOtherPercentage: number;

  /**
   * Minimum confidence threshold for classification
   */
  minConfidence: number;

  /**
   * Whether to throw on low confidence or mark as OTHER
   */
  strictMode: boolean;
}
