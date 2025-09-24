/**
 * Re-export validation contracts from core package
 *
 * This ensures single source of truth for validation interfaces.
 * All validation contracts are defined in @crypto/core and imported here.
 */
export type {
  ProcessorValidator,
  ClassifierValidator,
  TransformerValidator,
  ValidationIssue,
  ContractValidationResult,
  ValidationCodes,
} from '@crypto/core';

/**
 * Validation rule configuration (classification-specific)
 */
export interface ValidatorConfig {
  /**
   * Enabled validation rules (all enabled by default)
   */
  enabledRules?: ValidationRuleSet;

  /**
   * Maximum allowed manual overrides per transaction
   */
  maxManualOverrides?: number;

  /**
   * Minimum confidence threshold for classification
   */
  minConfidenceThreshold: number;

  /**
   * Whether to fail on low confidence classifications
   */
  requireHighConfidence: boolean;
}

/**
 * Configuration for which validation rules to enable
 */
export interface ValidationRuleSet {
  // Classifier validation rules
  checkAllMovementsClassified?: boolean;
  // Transformer validation rules
  checkBusinessRules?: boolean;
  checkConfidenceThresholds?: boolean;

  checkCostBasisRules?: boolean;
  checkRequiredFields?: boolean;
  checkRuleConsistency?: boolean;

  checkTradeMovements?: boolean;
  checkValuedZeroSum?: boolean;
  // Processor validation rules
  checkZeroSumTransfers?: boolean;
}
