/**
 * Validation Contracts for Multi-Level Transaction Validation
 *
 * Separates processor-time validation from transformer-time validation
 * to enable early error detection and clear responsibility boundaries.
 */

import { ProcessedTransaction, ClassifiedTransaction } from '../types';

export type Severity = 'info' | 'warn' | 'error';

export interface ValidationIssue {
  /**
   * Path to the field with the issue (e.g., "movements[1].quantity")
   */
  path: string;

  /**
   * Stable error code for programmatic handling
   */
  code: string;

  /**
   * Issue severity level
   */
  severity: Severity;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Additional context for debugging
   */
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  /**
   * Whether validation passed (no errors)
   */
  ok: boolean;

  /**
   * List of validation issues found
   */
  issues: ValidationIssue[];
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
   * @returns ValidationResult with any issues found
   */
  validate(tx: ProcessedTransaction): ValidationResult;

  /**
   * Validate multiple transactions in batch
   */
  validateMany(txs: ProcessedTransaction[]): ValidationResult[];
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
   * @returns ValidationResult with any issues found
   */
  validate(tx: ClassifiedTransaction): ValidationResult;

  /**
   * Validate classification quality across batch
   */
  validateBatch(txs: ClassifiedTransaction[]): ValidationResult;
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
   * @returns ValidationResult with any issues found
   */
  validate(tx: ClassifiedTransaction): ValidationResult;
}

/**
 * Common validation error codes
 */
export const ValidationCodes = {
  // Processor-time codes
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FIELD_FORMAT: 'INVALID_FIELD_FORMAT',
  NON_ZERO_SUM_TRANSFER: 'NON_ZERO_SUM_TRANSFER',
  INSUFFICIENT_TRADE_MOVEMENTS: 'INSUFFICIENT_TRADE_MOVEMENTS',
  INVALID_MOVEMENT_DIRECTION: 'INVALID_MOVEMENT_DIRECTION',
  NEGATIVE_QUANTITY: 'NEGATIVE_QUANTITY',

  // Classifier-time codes
  UNCLASSIFIED_MOVEMENT: 'UNCLASSIFIED_MOVEMENT',
  MISSING_CLASSIFICATION_INFO: 'MISSING_CLASSIFICATION_INFO',
  LOW_CONFIDENCE_CLASSIFICATION: 'LOW_CONFIDENCE_CLASSIFICATION',
  INCONSISTENT_RULE_APPLICATION: 'INCONSISTENT_RULE_APPLICATION',

  // Transformer-time codes
  VALUED_ZERO_SUM_VIOLATION: 'VALUED_ZERO_SUM_VIOLATION',
  INVALID_COST_BASIS: 'INVALID_COST_BASIS',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  REGULATORY_CONSTRAINT_VIOLATION: 'REGULATORY_CONSTRAINT_VIOLATION'
} as const;

export type ValidationCode = typeof ValidationCodes[keyof typeof ValidationCodes];

/**
 * Validation rule configuration
 */
export interface ValidationRuleConfig {
  /**
   * Whether this rule is enabled
   */
  enabled: boolean;

  /**
   * Severity level for violations of this rule
   */
  severity: Severity;

  /**
   * Custom parameters for rule execution
   */
  parameters?: Record<string, unknown>;
}

/**
 * Validator configuration
 */
export interface ValidatorConfig {
  /**
   * Rule configurations by validation code
   */
  rules: Partial<Record<ValidationCode, ValidationRuleConfig>>;

  /**
   * Whether to stop validation on first error
   */
  failFast: boolean;

  /**
   * Maximum number of issues to collect per transaction
   */
  maxIssuesPerTransaction: number;
}