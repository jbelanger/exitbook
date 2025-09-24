/**
 * Validation Contracts for Multi-Level Transaction Validation
 *
 * Separates processor-time validation from transformer-time validation
 * to enable early error detection and clear responsibility boundaries.
 */
import type { ProcessedTransaction, ClassifiedTransaction } from '@crypto/core';
import type { Result } from 'neverthrow';

export type Severity = 'info' | 'warn' | 'error';

export interface ValidationIssue {
  /**
   * Stable error code for programmatic handling
   */
  code: string;

  /**
   * Additional context for debugging
   */
  details?: Record<string, unknown>;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Path to the field with the issue (e.g., "movements[1].quantity")
   */
  path: string;

  /**
   * Issue severity level
   */
  severity: Severity;
}

export interface ValidationResult {
  /**
   * List of validation issues found
   */
  issues: ValidationIssue[];

  /**
   * Whether validation passed (no errors)
   */
  ok: boolean;
}

/**
 * Processor-time validation for fast consistency checks
 */
export interface ProcessorValidator {
  /**
   * Validate ProcessedTransaction for technical consistency
   *
   * Checks:
   * - Required fields present and valid
   * - Zero-sum transfers (net movements per currency)
   * - Trade validation (2+ movements with different currencies)
   * - Movement direction consistency
   *
   * @param tx - ProcessedTransaction to validate
   * @returns Result containing ValidationResult or validation error
   */
  validate(tx: ProcessedTransaction): Result<ValidationResult, string>;

  /**
   * Validate multiple transactions in batch
   * @returns Result containing array of ValidationResults or batch validation error
   */
  validateMany(txs: ProcessedTransaction[]): Result<ValidationResult[], string>;
}

/**
 * Classifier-time validation for purpose assignment
 */
export interface ClassifierValidator {
  /**
   * Validate ClassifiedTransaction for complete classification
   *
   * Checks:
   * - All movements have assigned purposes
   * - Classification metadata is complete
   * - Confidence scores within acceptable ranges
   * - Rule application consistency
   *
   * @param tx - ClassifiedTransaction to validate
   * @returns Result containing ValidationResult or validation error
   */
  validate(tx: ClassifiedTransaction): Result<ValidationResult, string>;

  /**
   * Validate classification quality across batch
   * @returns Result containing ValidationResult for batch or validation error
   */
  validateBatch(txs: ClassifiedTransaction[]): Result<ValidationResult, string>;
}

/**
 * Transformer-time validation for business rules
 */
export interface TransformerValidator {
  /**
   * Validate ClassifiedTransaction for business rule compliance
   *
   * Checks:
   * - Valued zero-sum requirements
   * - Cost basis application rules
   * - Accounting policy compliance
   * - Regulatory constraint adherence
   *
   * @param tx - ClassifiedTransaction to validate
   * @returns Result containing ValidationResult or validation error
   */
  validate(tx: ClassifiedTransaction): Result<ValidationResult, string>;
}

/**
 * Common validation error codes
 */
export const ValidationCodes = {
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  INCONSISTENT_RULE_APPLICATION: 'INCONSISTENT_RULE_APPLICATION',
  INSUFFICIENT_TRADE_MOVEMENTS: 'INSUFFICIENT_TRADE_MOVEMENTS',
  INVALID_COST_BASIS: 'INVALID_COST_BASIS',
  INVALID_FIELD_FORMAT: 'INVALID_FIELD_FORMAT',
  INVALID_MOVEMENT_DIRECTION: 'INVALID_MOVEMENT_DIRECTION',

  LOW_CONFIDENCE_CLASSIFICATION: 'LOW_CONFIDENCE_CLASSIFICATION',
  MISSING_CLASSIFICATION_INFO: 'MISSING_CLASSIFICATION_INFO',
  // Processor-time codes
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  NEGATIVE_QUANTITY: 'NEGATIVE_QUANTITY',

  NON_ZERO_SUM_TRANSFER: 'NON_ZERO_SUM_TRANSFER',
  REGULATORY_CONSTRAINT_VIOLATION: 'REGULATORY_CONSTRAINT_VIOLATION',
  // Classifier-time codes
  UNCLASSIFIED_MOVEMENT: 'UNCLASSIFIED_MOVEMENT',
  // Transformer-time codes
  VALUED_ZERO_SUM_VIOLATION: 'VALUED_ZERO_SUM_VIOLATION',
} as const;

export type ValidationCode = (typeof ValidationCodes)[keyof typeof ValidationCodes];

/**
 * Validation rule configuration
 */
export interface ValidationRuleConfig {
  /**
   * Whether this rule is enabled
   */
  enabled: boolean;

  /**
   * Custom parameters for rule execution
   */
  parameters?: Record<string, unknown>;

  /**
   * Severity level for violations of this rule
   */
  severity: Severity;
}

/**
 * Validator configuration
 */
export interface ValidatorConfig {
  /**
   * Whether to stop validation on first error
   */
  failFast: boolean;

  /**
   * Maximum number of issues to collect per transaction
   */
  maxIssuesPerTransaction: number;

  /**
   * Rule configurations by validation code
   */
  rules: Partial<Record<ValidationCode, ValidationRuleConfig>>;
}
